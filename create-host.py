#!/usr/bin/env python3
"""Create a separate iOS React Native host that installs a built npm tarball.
Usage: python3 create-host.py /absolute/new/host /absolute/package.tgz
"""
from pathlib import Path
import argparse
import hashlib
import re
import shutil
import ssl
import subprocess
import json
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host', type=Path)
parser.add_argument('artifact', type=Path)
parser.add_argument('--trust-anchors', type=Path)
parser.add_argument('--embedder', type=Path)
parser.add_argument('--detector', type=Path)
# The delivered zip places integration-manifest.json two levels above this script.
parser.add_argument('--integration-manifest', type=Path,
                    default=Path(__file__).resolve().parents[2] / 'integration-manifest.json')
args = parser.parse_args()
host = args.host.resolve()
artifact = args.artifact.resolve()
if host.exists():
    raise SystemExit('Choose a new host directory')
if not artifact.is_file():
    raise SystemExit('Package artifact does not exist')
if not args.integration_manifest.is_file():
    raise SystemExit('Integration manifest does not exist: ' + str(args.integration_manifest) +
                     '. Run this script from the unzipped delivery or pass --integration-manifest.')
# Refuse incomplete deliveries and missing tools before the CLI creates a partial host.
for command in ['npx', 'node', 'npm', 'ruby', 'pod', 'xcodebuild']:
    if shutil.which(command) is None:
        raise SystemExit('Required command is missing from PATH: ' + command)
try:
    subprocess.run(['ruby', '-rxcodeproj', '-e', 'exit'], check=True, capture_output=True)
except subprocess.CalledProcessError:
    raise SystemExit('The ruby on PATH cannot load xcodeproj. Install it for that Ruby before generating the host.')
try:
    subprocess.run(['xcodebuild', '-version'], check=True, capture_output=True)
except subprocess.CalledProcessError:
    raise SystemExit('Select the full Xcode installation and complete its first-launch setup before generating the host.')
node_version = subprocess.check_output(['node', '--version'], text=True).strip().lstrip('v')
if tuple(map(int, node_version.split('.')[:3])) < (22, 11, 0):
    raise SystemExit('React Native 0.87.1 requires Node 22.11.0 or later')
try:
    with tarfile.open(artifact, 'r:gz') as package:
        metadata = json.load(package.extractfile('package/package.json'))
        members = set(package.getnames())
        if metadata.get('name') != '@kenshiki/identity-capture':
            raise ValueError('Not an @kenshiki/identity-capture package')
        if metadata.get('version') != '0.6.0':
            raise ValueError('This reference host requires the matching 0.6.0 package')
        required = ['package/build-manifest.json',
                    'package/Frameworks/IdentityCaptureRuntime.xcframework/Info.plist']
        if any(name not in members for name in required):
            raise ValueError('Use the binary delivery tarball, not npm pack from an unbuilt source directory')
        binary_commit = json.load(package.extractfile('package/build-manifest.json')).get('sdkCommit')
    # Identity, not just name: the tarball must be the exact artifact this delivery recorded.
    delivery = json.loads(args.integration_manifest.read_text())
    if hashlib.sha256(artifact.read_bytes()).hexdigest() != delivery.get('sdkArtifactSHA256'):
        raise ValueError('SHA-256 differs from sdkArtifactSHA256 in ' + str(args.integration_manifest))
    if binary_commit != delivery.get('sdkBinarySourceCommit'):
        raise ValueError('build-manifest.json sdkCommit differs from sdkBinarySourceCommit in ' +
                         str(args.integration_manifest))
except (tarfile.TarError, KeyError, ValueError, TypeError, OSError) as error:
    raise SystemExit('Invalid SDK artifact: ' + str(error))
for source, directory in [(args.trust_anchors, False), (args.embedder, True), (args.detector, True)]:
    if source is not None and not (source.is_dir() if directory else source.is_file()):
        raise SystemExit('Resource must be a ' + ('compiled model directory: ' if directory else 'PEM file: ') + str(source))
# Content checks, before anything is created. They catch an empty or wrong file, not a wrong model
# or anchor set: a compiled model is a non-empty directory, and the PEM holds certificates.
for source in [args.embedder, args.detector]:
    if source is not None and not any(path.is_file() for path in source.rglob('*')):
        raise SystemExit('Compiled model directory contains no files: ' + str(source))
if args.trust_anchors is not None:
    blocks = re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',
                        args.trust_anchors.read_text(errors='replace'), re.S)
    try:
        if not blocks or any(not ssl.PEM_cert_to_DER_cert(block) for block in blocks):
            raise ValueError
    except ValueError:
        raise SystemExit('Trust anchors must be PEM certificates (BEGIN CERTIFICATE blocks): ' + str(args.trust_anchors))
subprocess.run(['npx', '--yes', '@react-native-community/cli@20.2.0', 'init', 'IdentitySDKHost',
                '--version', '0.87.1', '--directory', str(host), '--skip-install', '--skip-git-init'], check=True)
for filename in ['App.tsx', 'IdentityCaptureFlow.tsx', 'CaptureFlowController.ts',
                 'DriverLicenseFlow.tsx', 'DocumentFlowController.ts', 'DocumentCheckPanel.tsx', 'IdentitySheetHost.tsx',
                 'DocumentCheckPanel.test.tsx',
                 'DriverLicenseFlow.test.tsx', 'DocumentFlowController.test.ts',
                 'PhoneFlow.tsx', 'SubscriberResultDetails.tsx', 'PhoneFlowController.ts', 'PhoneFlow.test.tsx', 'PhoneFlowController.test.ts',
                 'SSNFlow.tsx', 'SSNFlowController.ts', 'SSNFlow.test.tsx', 'SSNFlowController.test.ts',
                 'HolderText.ts', 'ReferenceFindings.test.tsx', 'HolderLifecycle.test.tsx']:
    shutil.copyfile(Path(__file__).with_name(filename), host / filename)
shutil.copyfile(Path(__file__).with_name('CaptureFlowController.test.ts'), host / 'CaptureFlowController.test.ts')
shutil.copyfile(Path(__file__).with_name('IdentityCaptureFlow.test.tsx'), host / 'IdentityCaptureFlow.test.tsx')
# Replace the CLI's starter-screen test with this example's actual controller tests.
(host / '__tests__/App.test.tsx').unlink(missing_ok=True)
for source, filename in [(args.trust_anchors, 'masterList.pem'), (args.embedder, 'embedder.mlmodelc'),
                         (args.detector, 'detector.mlmodelc')]:
    if source is not None:
        resources = host / 'ios/CaptureResources'
        resources.mkdir(exist_ok=True)
        if source.is_dir():
            shutil.copytree(source.resolve(), resources / filename)
        else:
            shutil.copyfile(source.resolve(), resources / filename)
vendor = host / 'vendor'
vendor.mkdir()
shutil.copyfile(artifact, vendor / artifact.name)
podfile = host / 'ios/Podfile'
template_platform = 'platform :ios, min_ios_version_supported'
if template_platform not in podfile.read_text():
    raise SystemExit('The generated Podfile has no "' + template_platform + '" line to set to 18.0; '
                     'set the platform to 18.0 by hand in ' + str(podfile))
podfile.write_text(podfile.read_text().replace(template_platform, "platform :ios, '18.0'"))
subprocess.run(['npm', 'install', './vendor/' + artifact.name], cwd=host, check=True)
subprocess.run(['ruby', str(Path(__file__).with_name('configure-host.rb')), str(host)], check=True)
subprocess.run(['pod', 'install'], cwd=host / 'ios', check=True)
print('Independent host ready:', host)
