#!/usr/bin/env python3
"""Write the app's software bill of materials (CycloneDX 1.5 JSON) into sbom/.

- sbom/reference-app.cdx.json: every npm package the app installs, from `npm sbom` on package-lock.json, so the
  file is the same on every platform (an installed tree differs: macOS adds optional packages such as fsevents).
- sbom/identity-capture-native.cdx.json: the native frameworks inside @kenshiki/identity-capture, which npm
  cannot see. Each comes from what the installed package records: the framework's Info.plist version, the
  download URL and SHA-256 that build-manifest.json records for vendor frameworks, and the attributions in
  LICENSES/ (a version only where the file name states one).

Timestamps, serial numbers and the generating npm's version are left out so the files change only when
the inputs do.
Usage: python3 scripts/sbom.py [--check] [--package DIR]
"""
import argparse
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'sbom'
PACKAGE = ROOT / 'node_modules/@kenshiki/identity-capture'


def npm_sbom():
    document = json.loads(subprocess.check_output(
        ['npm', 'sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'application', '--package-lock-only'], cwd=ROOT))
    document.pop('serialNumber', None)
    document.get('metadata', {}).pop('timestamp', None)
    # The generating npm's version varies by machine; keep which tool wrote the file, not its patch level.
    for tool in document.get('metadata', {}).get('tools', []):
        tool.pop('version', None)
    # npm names the root after the checkout folder; use the package name so every checkout agrees.
    document['metadata']['component']['name'] = json.loads((ROOT / 'package.json').read_text())['name']
    return document


def framework_version(xcframework):
    """CFBundleShortVersionString of the device slice, or None when the framework records none."""
    for plist in sorted(xcframework.glob('ios-arm64/*.framework/Info.plist')):
        return plistlib.loads(plist.read_bytes()).get('CFBundleShortVersionString')
    return None


def native_sbom(package):
    manifest = json.loads((package / 'build-manifest.json').read_text())
    sdk = json.loads((package / 'package.json').read_text())
    vendor = {entry['component']: entry for entry in manifest.get('vendorFrameworks', [])}
    components = []
    for xcframework in sorted((package / 'Frameworks').glob('*.xcframework')):
        name = xcframework.name.removesuffix('.xcframework')
        component = {'type': 'framework', 'bom-ref': 'framework:' + name, 'name': name}
        version = sdk['version'] if name == 'IdentityCaptureRuntime' else framework_version(xcframework)
        if version:
            component['version'] = version
        if name in vendor:
            entry = vendor[name]
            component['version'] = entry['version']
            component['hashes'] = [{'alg': 'SHA-256', 'content': entry['checksum']}]
            component['externalReferences'] = [{'type': 'distribution', 'url': entry['url']}]
        components.append(component)
    for notice in sorted((package / 'LICENSES').glob('*.txt')):
        match = re.fullmatch(r'(.+?)-(\d+\.\d+\.\d+)', notice.stem)
        name, version = (match[1], match[2]) if match else (notice.stem, None)
        component = {'type': 'library', 'bom-ref': 'notice:' + notice.stem, 'name': name,
                     'licenses': [{'license': {'name': 'See LICENSES/' + notice.name}}]}
        if version:
            component['version'] = version
        components.append(component)
    return {
        'bomFormat': 'CycloneDX', 'specVersion': '1.5', 'version': 1,
        'metadata': {'component': {'type': 'library', 'bom-ref': 'sdk', 'name': sdk['name'],
                                   'version': sdk['version'],
                                   'properties': [{'name': 'sdkCommit', 'value': manifest['sdkCommit']}]}},
        'components': components,
        'dependencies': [{'ref': 'sdk', 'dependsOn': [c['bom-ref'] for c in components]}],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='fail when sbom/ differs from the installed tree')
    parser.add_argument('--package', type=Path, default=PACKAGE, help='installed @kenshiki/identity-capture')
    args = parser.parse_args()
    documents = {'reference-app.cdx.json': npm_sbom(),
                 'identity-capture-native.cdx.json': native_sbom(args.package)}
    stale = []
    for name, document in documents.items():
        text = json.dumps(document, indent=2, sort_keys=True) + '\n'
        path = OUTPUT / name
        if args.check:
            if not path.is_file() or path.read_text() != text:
                stale.append(name)
        else:
            OUTPUT.mkdir(exist_ok=True)
            path.write_text(text)
            print('wrote sbom/' + name)
    if stale:
        print('stale: ' + ', '.join('sbom/' + name for name in stale) + '. Run python3 scripts/sbom.py.',
              file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
