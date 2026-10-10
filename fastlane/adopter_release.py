#!/usr/bin/env python3
"""Prepare provenance for an adopter-owned app, without the private SDK repository."""
import argparse
import datetime
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tarfile
import release_preflight as signing
from verify_export import sha256, require


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source.resolve()), *args], text=True).strip()


def check_source(source, revision):
    require(re.fullmatch(r'[0-9a-f]{40}', revision), 'APP_REVISION must be a full commit SHA')
    require(git(source, 'rev-parse', 'HEAD') == revision, 'App HEAD differs from APP_REVISION')
    require(not git(source, 'status', '--porcelain'), 'Commit app changes before building or uploading')


def verified_sdk(host, artifact, reference):
    require(sha256(artifact) == reference['sdkArtifactSHA256'], 'Vendor SDK artifact differs from delivery')
    installed = host / 'node_modules/@kenshiki/identity-capture'
    require(installed.resolve().is_relative_to(host.resolve()), 'Installed SDK escapes host')
    manifest_path = installed / 'build-manifest.json'
    require(manifest_path.resolve().is_relative_to(installed.resolve()), 'SDK manifest escapes package')
    manifest = json.loads(manifest_path.read_text())
    with tarfile.open(artifact, 'r:gz') as archive:
        entries = [m for m in archive.getmembers() if m.name == 'package/build-manifest.json']
        require(len(entries) == 1 and entries[0].isfile(), 'SDK artifact requires one regular build manifest')
        expected = json.load(archive.extractfile(entries[0]))
    require(manifest == expected, 'Installed SDK manifest differs from delivered artifact')
    require(manifest['sdkCommit'] == reference['sdkBinarySourceCommit'], 'Installed SDK binary provenance mismatch')
    hashes = manifest.get('fileSHA256')
    require(isinstance(hashes, dict) and bool(hashes), 'Missing SDK file hash inventory')
    files = [manifest_path]
    for name, digest in hashes.items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe SDK file path')
        path = installed / relative
        require(path.resolve().is_relative_to(installed.resolve()), 'SDK file escapes package')
        require(path.is_file() and sha256(path) == digest, 'Installed SDK file differs: ' + name)
        files.append(path)
    return manifest, files


def prepare(args):
    check_source(args.source, args.revision)
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(args.profile.resolve())]))
    identities = signing.usable_identities(signing.command('security', 'find-identity', '-v', '-p', 'codesigning'))
    selected = signing.profile_result(profile, args.profile, args.team, args.bundle, identities,
                                      datetime.datetime.now(datetime.timezone.utc))
    require(not selected['errors'], '; '.join(selected['errors']))
    selected['uuid'] = profile['UUID']
    delivery = args.host / 'vendor'
    reference = json.loads((delivery / 'integration-manifest.json').read_text())
    artifact = delivery / reference['sdkArtifact']
    require(artifact.parent == delivery, 'Artifact name must be a filename')
    manifest, _ = verified_sdk(args.host, artifact, reference)
    preflight = {'status': 'prerequisites_present', 'revision': args.revision, 'team': args.team,
                 'bundle_id': args.bundle, 'selected_profile': selected,
                 'required_entitlements': signing.REQUIRED_ENTITLEMENTS}
    inputs = {'sourceRevision': args.revision, 'appSourceRevision': args.revision,
              'sdkBinarySourceCommit': manifest['sdkCommit'], 'bundleIdentifier': args.bundle,
              'version': args.version, 'buildNumber': args.build,
              'sdkArtifactSHA256': reference['sdkArtifactSHA256'],
              'referenceManifestSHA256': sha256(delivery / 'integration-manifest.json'),
              'host': str(args.host), 'delivery': str(delivery), 'sdkArtifact': str(artifact),
              'inputSHA256': {}, 'appSource': str(args.source)}
    (args.out / 'preflight.json').write_text(json.dumps(preflight, indent=2) + '\n')
    (args.out / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')


def freeze(out):
    path = out / 'inputs.json'
    inputs = json.loads(path.read_text())
    host = Path(inputs['host'])
    names = subprocess.check_output(['git', '-C', str(host), 'ls-files', '-z']).decode().split('\0')
    files = [host / name for name in names if name and (host / name).is_file()]
    delivery_manifest = Path(inputs['delivery']) / 'integration-manifest.json'
    require(sha256(delivery_manifest) == inputs['referenceManifestSHA256'], 'Delivery manifest changed')
    _, sdk_files = verified_sdk(host, Path(inputs['sdkArtifact']), json.loads(delivery_manifest.read_text()))
    files += sdk_files + [host / 'ios/Podfile.lock', host / 'ios/Pods/Manifest.lock']
    require((host / 'ios/Podfile.lock').read_bytes() == (host / 'ios/Pods/Manifest.lock').read_bytes(),
            'Pods are out of sync')
    inputs['inputSHA256'] = {str(file): sha256(file) for file in sorted(set(files))}
    path.write_text(json.dumps(inputs, indent=2) + '\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare', 'freeze', 'source'])
    p.add_argument('--out', type=Path, required=True)
    for name in ['source', 'host', 'profile']:
        p.add_argument('--' + name, type=Path)
    for name in ['revision', 'team', 'bundle', 'version', 'build']:
        p.add_argument('--' + name)
    a = p.parse_args()
    if a.action == 'prepare':
        prepare(a)
    elif a.action == 'freeze':
        freeze(a.out)
    else:
        inputs = json.loads((a.out / 'inputs.json').read_text())
        check_source(Path(inputs['appSource']), inputs['appSourceRevision'])


if __name__ == '__main__':
    main()
