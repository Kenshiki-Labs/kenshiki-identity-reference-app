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
for name in ('SensorSSNService', 'SensorPhoneService', 'SensorPhoneWireEvidence', 'WorkerDocumentChecker', 'SensorPhoneDocumentContext'):
    target['sources'].append(str(root / 'Hosts/SensorHost/Sources' / (name + '.swift')))
for name in ('IdentityGateway', 'IdentityEvidenceRegula'):
    dependency = {'package': name, 'product': name}
    if dependency not in target['dependencies']:
        target['dependencies'].append(dependency)
# This host framework is built with its application, not distributed as a stable SDK artifact.
target['settings']['base']['BUILD_LIBRARY_FOR_DISTRIBUTION'] = False
spec['targets'] = {'IdentityCaptureRuntime': target}
spec['schemes']['IdentityCaptureRuntime'].pop('test', None)
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
path = output / 'project.yml'
path.write_text(yaml.safe_dump(spec, sort_keys=False))
subprocess.run(['xcodegen', 'generate', '--spec', str(path), '--project', str(output)], check=True)
