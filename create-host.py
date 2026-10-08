#!/usr/bin/env python3
"""Create a separate iOS React Native host that installs a built npm tarball.
Usage: python3 create-host.py /absolute/new/host /absolute/package.tgz
"""
from pathlib import Path
import argparse
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host', type=Path)
parser.add_argument('artifact', type=Path)
parser.add_argument('--trust-anchors', type=Path)
parser.add_argument('--embedder', type=Path)
parser.add_argument('--detector', type=Path)
args = parser.parse_args()
host = args.host.resolve()
artifact = args.artifact.resolve()
if host.exists():
    raise SystemExit('Choose a new host directory')
if not artifact.is_file():
    raise SystemExit('Package artifact does not exist')
subprocess.run(['npx', '--yes', '@react-native-community/cli@20.2.0', 'init', 'IdentitySDKHost',
                '--version', '0.87.1', '--directory', str(host), '--skip-install', '--skip-git-init'], check=True)
for filename in ['App.tsx', 'IdentityCaptureFlow.tsx', 'CaptureFlowController.ts']:
    shutil.copyfile(Path(__file__).with_name(filename), host / filename)
shutil.copyfile(Path(__file__).with_name('CaptureFlowController.test.ts'), host / 'CaptureFlowController.test.ts')
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
podfile.write_text(podfile.read_text().replace('platform :ios, min_ios_version_supported', "platform :ios, '18.0'"))
subprocess.run(['npm', 'install', './vendor/' + artifact.name], cwd=host, check=True)
subprocess.run(['ruby', str(Path(__file__).with_name('configure-host.rb')), str(host)], check=True)
subprocess.run(['pod', 'install'], cwd=host / 'ios', check=True)
print('Independent host ready:', host)
