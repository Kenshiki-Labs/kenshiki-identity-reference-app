#!/usr/bin/env python3
"""Configure a disposable reference host for the owner-authorized live service build.
This replaces only that host's local framework slice, never a delivery tarball. Requires the
matching source-built runtime products and licensed Regula resources supplied by the operator.
"""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('host', type=Path)
parser.add_argument('products', type=Path)
parser.add_argument('regula_resources', type=Path)
args = parser.parse_args()
host, products, resources = (p.resolve() for p in (args.host, args.products, args.regula_resources))
frameworks = ('IdentityCaptureRuntime', 'DocumentReader', 'DocumentReaderCore', 'RegulaCommon')
for name in frameworks:
    if not (products / (name + '.framework')).is_dir():
        parser.error('Missing built framework: ' + name)
bridge_name = 'IdentityEvidenceOpenCVBridge'
bridge = products / (bridge_name + '.framework')
if not bridge.is_dir():
    parser.error('Missing matching native bridge framework')
subprocess.run(['python3', str(Path(__file__).with_name('verify_host_bridge.py')),
                str(products / 'IdentityCaptureRuntime.framework/IdentityCaptureRuntime'),
                str(bridge / bridge_name)], check=True)
for name in ('regula.license', 'db.dat', 'regula-provenance.json'):
    if not (resources / name).is_file():
        parser.error('Missing licensed resource: ' + name)
slice_path = host / 'node_modules/@kenshiki/identity-capture/Frameworks/IdentityCaptureRuntime.xcframework/ios-arm64'
if not slice_path.is_dir():
    parser.error('Host does not contain the expected device framework slice')
bridge_target = slice_path.parents[1] / (bridge_name + '.xcframework') / 'ios-arm64' / (bridge_name + '.framework')
if not bridge_target.is_dir():
    parser.error('Host does not contain the expected native bridge device slice')
# Remove obsolete module interfaces from the disposable host's previous framework build.
shutil.rmtree(slice_path / 'IdentityCaptureRuntime.framework')
shutil.copytree(products / 'IdentityCaptureRuntime.framework', slice_path / 'IdentityCaptureRuntime.framework')
# The runtime imports this private C ABI dynamically; copying only the runtime
# would leave an older npm artifact with missing symbols at application launch.
shutil.rmtree(bridge_target)
shutil.copytree(bridge, bridge_target)
vendor = host / 'ios/LiveServiceFrameworks'
vendor.mkdir(exist_ok=True)
for name in frameworks[1:]:
    shutil.copytree(products / (name + '.framework'), vendor / (name + '.framework'), dirs_exist_ok=True)
resource_target = host / 'ios/LocalCaptureResources/Regula'
resource_target.mkdir(parents=True, exist_ok=True)
for name in ('regula.license', 'db.dat', 'regula-provenance.json'):
    shutil.copyfile(resources / name, resource_target / name)
source = Path(__file__).resolve().parent.parent
for pattern in ('*.ts', '*.tsx'):
    for module in source.glob(pattern):
        shutil.copyfile(module, host / module.name)
for directory in ('locales', 'ui', 'sensor-presentation', '__tests__'):
    shutil.copytree(source / directory, host / directory, dirs_exist_ok=True)
# Keep the Objective-C facade (including C linkage) paired with its source-built runtime.
package = host / 'node_modules/@kenshiki/identity-capture'
for directory in ('ios', 'src'):
    shutil.copytree(source.parents[1] / 'ReactNative/identity-capture' / directory,
                    package / directory, dirs_exist_ok=True)
shutil.copyfile(source / 'AppDelegate.swift', host / 'ios/IdentitySDKHost/AppDelegate.swift')
# CocoaPods refreshes autolinking before generating Fabric headers from the copied specs.
# A direct codegen call can reuse another disposable host's cached dependency roots.
subprocess.run(['pod', 'install', '--deployment'], cwd=host / 'ios', check=True)
subprocess.run(['ruby', str(Path(__file__).with_name('configure-host.rb')), str(host), str(products)], check=True)
