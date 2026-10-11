#!/usr/bin/env python3
"""Generate the nonproduction source-built runtime; never modifies the binary delivery.
Requires PyYAML and XcodeGen. Usage: generate-project.py /absolute/build-directory
"""
import argparse
from pathlib import Path
import subprocess
import yaml

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
base = root / 'Distribution/IdentityCaptureRuntime'
spec = yaml.safe_load((base / 'project.yml').read_text())
for package in spec['packages'].values():
    if 'path' in package:
        package['path'] = str((base / package['path']).resolve())
for name in ('IdentityGateway', 'IdentityEvidenceRegula'):
    spec['packages'][name] = {'path': str(root / 'Packages' / name)}
target = spec['targets']['IdentityCaptureRuntime']
target['sources'] = [str(base / 'Sources'), *[str(p) for p in sorted(Path(__file__).parent.glob('*.swift'))]]
for name in ('IdentityGateway', 'IdentityEvidenceRegula'):
    dependency = {'package': name, 'product': name}
    if dependency not in target['dependencies']:
        target['dependencies'].append(dependency)
# This host framework is built with its application, not distributed as a stable SDK artifact.
target['settings']['base']['BUILD_LIBRARY_FOR_DISTRIBUTION'] = False
# The adapters' contract tests run against the Worker's own fixture, beside the adapters.
tests = {'type': 'bundle.unit-test', 'platform': 'iOS',
         'sources': [str(Path(__file__).parent / 'Tests')],
         'settings': {'base': {'GENERATE_INFOPLIST_FILE': 'YES', 'SWIFT_VERSION': '6.0',
                               'PRODUCT_BUNDLE_IDENTIFIER': 'org.identity.capture.runtime.live-services-tests'}},
         'dependencies': [{'target': 'IdentityCaptureRuntime'},
                          {'package': 'KenshikiIdentitySDK', 'product': 'IdentityDocumentCheck'},
                          {'package': 'KenshikiIdentitySDK', 'product': 'KenshikiIdentity'},
                          {'package': 'IdentityGateway', 'product': 'IdentityGateway'}]}
spec['targets'] = {'IdentityCaptureRuntime': target, 'LiveServicesTests': tests}
spec['schemes']['IdentityCaptureRuntime']['test'] = {'targets': ['LiveServicesTests']}
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
path = output / 'project.yml'
path.write_text(yaml.safe_dump(spec, sort_keys=False))
subprocess.run(['xcodegen', 'generate', '--spec', str(path), '--project', str(output)], check=True)
