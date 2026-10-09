#!/usr/bin/env python3
"""Prepare provenance for an adopter-owned app, without the private SDK repository."""
import argparse
import datetime
import json
from pathlib import Path
import plistlib
import re
import subprocess
import release_preflight as signing
from verify_export import sha256, require


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()


def check_source(source, revision):
    require(re.fullmatch(r'[0-9a-f]{40}', revision), 'APP_REVISION must be a full commit SHA')
    require(git(source, 'rev-parse', 'HEAD') == revision, 'App HEAD differs from APP_REVISION')
    require(not git(source, 'status', '--porcelain'), 'Commit app changes before building or uploading')


def prepare(args):
    check_source(args.source, args.revision)
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(args.profile)]))
    identities = signing.usable_identities(signing.command('security', 'find-identity', '-v', '-p', 'codesigning'))
    selected = signing.profile_result(profile, args.profile, args.team, args.bundle, identities,
                                      datetime.datetime.now(datetime.timezone.utc))
    require(not selected['errors'], '; '.join(selected['errors']))
    selected['uuid'] = profile['UUID']
    delivery = args.host / 'vendor'
    reference = json.loads((delivery / 'integration-manifest.json').read_text())
    artifact = delivery / reference['sdkArtifact']
    require(artifact.parent == delivery, 'Artifact name must be a filename')
    require(sha256(artifact) == reference['sdkArtifactSHA256'], 'Vendor SDK artifact differs from delivery')
    manifest = json.loads((args.host / 'node_modules/@kenshiki/identity-capture/build-manifest.json').read_text())
    require(manifest['sdkCommit'] == reference['sdkBinarySourceCommit'], 'Installed SDK binary provenance mismatch')
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
    files += [host / 'node_modules/@kenshiki/identity-capture/build-manifest.json', host / 'ios/Podfile.lock']
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
