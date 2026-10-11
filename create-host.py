#!/usr/bin/env python3
"""Create a separate iOS React Native host that installs a built npm tarball.
Usage: python3 create-host.py /absolute/new/host /absolute/package.tgz
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import importlib.util
import re
import shutil
import ssl
import subprocess
import json
import sys
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host', type=Path)
parser.add_argument('artifact', type=Path)
parser.add_argument('--trust-anchors', type=Path)
parser.add_argument('--embedder', type=Path)
parser.add_argument('--detector', type=Path)
parser.add_argument('--regula-license', type=Path, help='adopter-owned document reader licence')
parser.add_argument('--regula-database', type=Path, help='adopter-owned document reader database')
parser.add_argument('--regula-provenance', type=Path, help='document reader resource provenance JSON')
# Signing for a physical iPhone. Each is optional; without them the generated app keeps the template's
# identifier and no team, which is what the simulator tests use.
parser.add_argument('--bundle-identifier', help="the app's bundle identifier, a registered App ID")
parser.add_argument('--development-team', help='the Apple developer team that signs the app (automatic signing)')
parser.add_argument('--app-attest-environment', choices=['development', 'production'],
                    help='the App Attest environment the app is entitled to; the server it attests to decides')
# The delivered zip places integration-manifest.json two levels above this script.
parser.add_argument('--integration-manifest', type=Path,
                    default=Path(__file__).resolve().parents[2] / 'integration-manifest.json')
args = parser.parse_args()
host = args.host.resolve()
artifact = args.artifact.resolve()
if args.host.is_symlink() or host.exists():
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
node_match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', node_version)
node_release = tuple(map(int, node_match.groups())) if node_match else None
# Pinned react-native 0.87.1 package.json: ^22.13.0 || ^24.3.0 || >=26.0.0.
if node_release is None or not (
        node_release[0] == 22 and node_release >= (22, 13, 0)
        or node_release[0] == 24 and node_release >= (24, 3, 0)
        or node_release[0] >= 26):
    raise SystemExit('React Native 0.87.1 requires Node 22.x >=22.13.0, 24.x >=24.3.0, '
                     'or >=26.0.0. The tested reference toolchain uses Node 22.22.2.')
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
    artifact_name = delivery.get('sdkArtifact')
    if not isinstance(artifact_name, str) or not artifact_name or Path(artifact_name).name != artifact_name or artifact_name in {'.', '..'} or '\\' in artifact_name:
        raise ValueError('Manifest sdkArtifact must be a filename')
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
regula = [args.regula_license, args.regula_database, args.regula_provenance]
if any(source is not None for source in regula):
    if not all(source is not None and source.is_file() and source.stat().st_size > 0 for source in regula):
        raise SystemExit('Supply all three nonempty --regula-license, --regula-database and --regula-provenance files.')
    try:
        if not isinstance(json.loads(args.regula_provenance.read_text()), dict):
            raise ValueError('Expected a JSON object')
    except (OSError, ValueError):
        raise SystemExit('Regula provenance must be a readable JSON object. Runtime verification remains required.')
# The manifest owns every TypeScript module, including nested UI and test helpers. Validate before
# the CLI creates a host, then copy the same bytes so generation cannot mix source revisions.
host_prefix = 'Examples/ReactNativeCaptureHost/'
reference = Path(__file__).parent
typescript_sources = {}
native_support = {}
for name, expected in sorted(delivery['fileSHA256'].items()):
    if not name.startswith(host_prefix):
        continue
    relative_name = name[len(host_prefix):]
    relative = PurePosixPath(relative_name)
    if (not relative.parts or relative.is_absolute() or '..' in relative.parts
            or '\\' in relative_name or str(relative) != relative_name):
        raise SystemExit('Invalid reference source path in integration manifest: ' + name)
    if relative.suffix not in {'.ts', '.tsx', '.swift', '.rb', '.py'}:
        continue
    source = reference / relative
    linked = any((reference.joinpath(*relative.parts[:index])).is_symlink()
                 for index in range(1, len(relative.parts) + 1))
    if linked or not source.is_file():
        raise SystemExit('Reference source is missing or is a symbolic link: ' + relative_name)
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Reference source differs from the integration manifest: ' + relative_name)
    if relative.suffix in {'.ts', '.tsx'}:
        typescript_sources[relative_name] = data.decode('utf-8')
    else:
        native_support[relative_name] = data
if 'App.tsx' not in typescript_sources:
    raise SystemExit('The integration manifest has no reference app entry point')
required_support = {'configure-host.rb', 'configure-native-tests.rb', 'ArtifactNativeTests.swift',
                    'NativeArtifactTestHost.swift', 'validate-installed-host.py', 'AppDelegate.swift',
                    'ArtifactIntegrationTests.swift', 'DeviceAcceptanceTests.swift'}
if not required_support.issubset(native_support):
    raise SystemExit('The integration manifest is missing native host support: ' +
                     ', '.join(sorted(required_support - native_support.keys())))
# The screens import typed modules compiled from ui/tokens.jsonc and locales/*.jsonc. Refuse to
# copy modules that differ from their sources, before anything is created.
generator = Path(__file__).with_name('generate-ui-resources.py')
if subprocess.run([sys.executable, str(generator), '--check']).returncode != 0:
    raise SystemExit('The generated UI modules differ from their JSONC sources. Run ' + str(generator) +
                     ' and try again.')
# The brand: the app's name under its icon comes from the English catalog, read with the generator's
# own JSONC reader; the icon and the launch screen come from brand/. Both are checked before anything
# is created.
specification = importlib.util.spec_from_file_location('generate_ui_resources', generator)
ui_resources = importlib.util.module_from_spec(specification)
specification.loader.exec_module(ui_resources)
app_name = ui_resources.load_jsonc(ui_resources.LOCALES / 'en.jsonc').get('brand', {}).get('appName')
if not isinstance(app_name, str) or not app_name.strip():
    raise SystemExit('locales/en.jsonc has no brand.appName, the name shown under the app icon')
brand = Path(__file__).with_name('brand')
icons = sorted(brand.glob('*.icon'))
if len(icons) != 1 or not (brand / 'LaunchScreen.storyboard').is_file():
    raise SystemExit('brand/ must hold exactly one Icon Composer .icon and a LaunchScreen.storyboard: ' + str(brand))
subprocess.run(['npx', '--yes', '@react-native-community/cli@20.2.0', 'init', 'IdentitySDKHost',
                '--version', '0.87.1', '--directory', str(host), '--replace-directory', 'false',
                '--skip-install', '--skip-git-init'], check=True)
with (host / '.gitignore').open('a') as ignored:
    ignored.write('\n# Local Fastlane output and signing credentials\n/fastlane/report.xml\n/fastlane/README.md.generated\n/fastlane/Preview.html\n*.p8\n*.p12\n*.mobileprovision\n.env\n.env.*\n')
# The sensor screens read SensorHost's own words, configuration and documentation pages, generated
# from Hosts/SensorHost by sensor-presentation/generate.py. Only the generated files travel: the
# generator reads the Swift host's sources, which a delivery does not carry.
(host / 'sensor-presentation').mkdir()
for name in ['config.json', 'copy.json', 'pages.json']:
    shutil.copyfile(Path(__file__).parent / 'sensor-presentation' / name, host / 'sensor-presentation' / name)
# Design tokens and UI text: the JSONC sources, their generated modules, the t() runtime and its
# test, and the generator, so the new host can change its look and words and regenerate.
for folder in ['ui', 'locales', 'fastlane']:
    shutil.copytree(Path(__file__).with_name(folder), host / folder,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.ts', '*.tsx'))
# The brand's icon, launch screen and launch assets. configure-host.rb installs them in the iOS app.
shutil.copytree(brand, host / 'brand')
shutil.copyfile(generator, host / generator.name)
# Remove the CLI starter before copying, so a delivered test with that name remains intact.
(host / '__tests__/App.test.tsx').unlink(missing_ok=True)
for filename, contents in typescript_sources.items():
    contents = re.sub(r'(?:\.\./)+ReactNative/identity-capture/src(?=/|[\'\"])',
                      '@kenshiki/identity-capture/src', contents)
    destination = host / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(contents)
for source, filename in [(args.trust_anchors, 'masterList.pem'), (args.embedder, 'embedder.mlmodelc'),
                         (args.detector, 'detector.mlmodelc')]:
    if source is not None:
        resources = host / 'ios/CaptureResources'
        resources.mkdir(exist_ok=True)
        if source.is_dir():
            shutil.copytree(source.resolve(), resources / filename)
        else:
            shutil.copyfile(source.resolve(), resources / filename)
if all(source is not None for source in regula):
    resources = host / 'ios/CaptureResources/Regula'
    resources.mkdir(parents=True, exist_ok=True)
    for source, filename in zip(regula, ['regula.license', 'db.dat', 'regula-provenance.json']):
        shutil.copyfile(source.resolve(), resources / filename)
# The validation harness is delivered with the host. It reads the installed artifact and manifest,
# never a sibling SDK checkout. Optional resources alone do not register a document service.
for filename in ['validate-installed-host.py']:
    if filename in native_support:
        (host / filename).write_bytes(native_support[filename])
vendor = host / 'vendor'
vendor.mkdir()
shutil.copyfile(artifact, vendor / artifact_name)
# Adopters retain the delivered binary provenance independently of their app's Git history.
shutil.copyfile(args.integration_manifest, vendor / 'integration-manifest.json')
# Preserve the original manifest-bound modules as JSON, not extra Jest-discoverable source files.
# The installed-host validator can then independently repeat and check the import rewrite.
(vendor / 'reference-sources.json').write_text(json.dumps(typescript_sources, sort_keys=True) + '\n')
podfile = host / 'ios/Podfile'
template_platform = 'platform :ios, min_ios_version_supported'
if template_platform not in podfile.read_text():
    raise SystemExit('The generated Podfile has no "' + template_platform + '" line to set to 18.0; '
                     'set the platform to 18.0 by hand in ' + str(podfile))
podfile.write_text(podfile.read_text().replace(template_platform, "platform :ios, '18.0'"))
subprocess.run(['npm', 'install', './vendor/' + artifact_name], cwd=host, check=True)
# Native navigation, pinned to the versions the SDK checkout typechecks and tests against: native
# stacks, and bottom-tabs' native UITabBar navigator (its `unstable` entry). react-native-screens
# 4.28.0 is built against React Native 0.87.0-rc.3 and supports Fabric on 0.84+.
navigation = ['@react-navigation/native@7.5.0', '@react-navigation/native-stack@7.20.0',
              '@react-navigation/bottom-tabs@7.20.0', 'react-native-screens@4.28.0',
              'react-native-safe-area-context@5.10.1']
subprocess.run(['npm', 'install', '--save-exact'] + navigation, cwd=host, check=True)
# Only *.test files are suites; __tests__ also contains shared support and fixtures.
# Navigation ships ES modules; the installed SDK's declared entry points ship TypeScript.
jest_config = host / 'jest.config.js'
preset = re.fullmatch(r"module\.exports = \{\s*preset: '([^']+)',?\s*\};?\s*", jest_config.read_text())
if preset is None:
    raise SystemExit('The generated jest.config.js is not the one-line preset this script extends; add '
                     '@kenshiki/identity-capture, @react-navigation, react-native-screens and '
                     'react-native-safe-area-context to its '
                     'transformIgnorePatterns by hand: ' + str(jest_config))
jest_config.write_text(
    "module.exports = {\n  preset: '" + preset.group(1) + "',\n"
    "  testMatch: ['<rootDir>/**/*.test.ts?(x)'],\n  transformIgnorePatterns: [\n"
    "    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation"
    "|react-native-screens|react-native-safe-area-context|@kenshiki/identity-capture)/)',\n  ],\n};\n")
signing = []
for flag, value in [('--bundle-identifier', args.bundle_identifier), ('--development-team', args.development_team),
                    ('--app-attest-environment', args.app_attest_environment)]:
    if value is not None:
        signing += [flag, value]
subprocess.run(['ruby', str(Path(__file__).with_name('configure-host.rb')), str(host), app_name, *signing],
               check=True)
subprocess.run(['pod', 'install'], cwd=host / 'ios', check=True)
print('Independent host ready:', host)
