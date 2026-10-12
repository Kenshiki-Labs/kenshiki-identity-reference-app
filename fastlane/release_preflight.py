#!/usr/bin/env python3
"""Inspect App Store signing prerequisites; never archive, upload or export private keys."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import uuid

# Required in every release profile.
REQUIRED_ENTITLEMENTS = {
    'com.apple.developer.nfc.readersession.formats': ['TAG'],
    'com.apple.developer.weatherkit': True,
    'com.apple.developer.devicecheck.appattest-environment': 'production',
}
# Opt-in capabilities. Wi-Fi info gives the sensor board the network name and familiarity token;
# without it those fields are absent and identity capture is unaffected.
OPTIONAL_ENTITLEMENTS = {
    'wifi-info': {'com.apple.developer.networking.wifi-info': True},
}


def required_entitlements(optional=()):
    required = dict(REQUIRED_ENTITLEMENTS)
    for name in optional:
        required.update(OPTIONAL_ENTITLEMENTS[name])
    return required


def command(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


def usable_identities(output):
    """security -v lists valid certificate/private-key identities, not certificates alone."""
    return {match.upper() for match in re.findall(r'^\s*\d+\)\s+([0-9a-fA-F]{40})\s+"', output, re.M)}


def source_policy(head, expected, changes, remote_main, stage):
    blockers, notes = [], []
    if changes:
        blockers.append('Source checkout has uncommitted changes.')
    if head != expected:
        blockers.append('Source HEAD does not match the requested release revision.')
    if head != remote_main:
        if stage == 'distribution':
            blockers.append('Requested integration revision is not remote main.')
        else:
            notes.append('Candidate revision differs from remote main; this preflight does not upload it.')
    return blockers, notes


def profile_result(profile, path, team, bundle_id, identities, now, required=None):
    required = REQUIRED_ENTITLEMENTS if required is None else required
    errors, missing = [], []
    entitlements = profile.get('Entitlements', {})
    if not isinstance(entitlements, dict):
        entitlements = {}
    if profile.get('TeamIdentifier') != [team]:
        errors.append('TeamIdentifier does not match the requested team.')
    if entitlements.get('com.apple.developer.team-identifier') != team:
        errors.append('Profile team entitlement does not match the requested team.')
    if entitlements.get('application-identifier') != team + '.' + bundle_id:
        errors.append('Profile application identifier does not match the requested app.')
    # App Store profiles have neither a registered-device list nor all-device distribution.
    if 'ProvisionedDevices' in profile or 'ProvisionsAllDevices' in profile:
        errors.append('Profile is not App Store distribution (device/enterprise provisioning present).')
    if entitlements.get('get-task-allow') is not False:
        errors.append('App Store profile must explicitly disable get-task-allow.')
    for key, value in required.items():
        actual = entitlements.get(key)
        if isinstance(value, list):
            valid = isinstance(actual, list) and all(item in actual for item in value)
        elif isinstance(value, str):
            valid = actual == value or isinstance(actual, list) and value in actual
        else:
            valid = actual is value
        if not valid:
            missing.append(key)
    if missing:
        errors.append('Profile lacks required entitlements.')
    expiration = profile.get('ExpirationDate')
    if isinstance(expiration, datetime.datetime):
        expiration = expiration.replace(tzinfo=datetime.timezone.utc) if expiration.tzinfo is None else expiration
        expired = expiration <= now
    else:
        expired = True
    if expired:
        errors.append('Profile expiration is missing or expired.')
    try:
        identifier = str(uuid.UUID(profile.get('UUID', ''))).upper()
    except (ValueError, TypeError, AttributeError):
        identifier = None
        errors.append('Profile UUID is invalid.')
    certificates = profile.get('DeveloperCertificates', [])
    hashes = sorted({hashlib.sha1(cert, usedforsecurity=False).hexdigest().upper() for cert in certificates if isinstance(cert, bytes)}) if isinstance(certificates, list) else []
    usable = sorted(set(hashes) & identities)
    if not usable:
        errors.append('No profile certificate matches an available valid signing identity/private key.')
    return {'uuid': identifier, 'name': profile.get('Name'), 'path': str(path),
            'expires': expiration.isoformat() if isinstance(expiration, datetime.datetime) else None,
            'expired': expired, 'missing_entitlements': missing,
            'certificate_sha1': usable[0] if usable else None, 'errors': errors}


def select_profile(profiles, requested_uuid=None):
    candidates = profiles
    if requested_uuid:
        candidates = [p for p in profiles if p['uuid'] == requested_uuid.upper()]
        if not candidates:
            return None, ['Requested profile UUID was not found.']
        if any(p['errors'] for p in candidates):
            return None, ['Requested profile failed signing requirements.']
    else:
        candidates = [p for p in candidates if not p['errors']]
    # Same profile can be installed in both Xcode profile folders. Different copies with the
    # same UUID must agree on signing identity and validity; otherwise selection is ambiguous.
    unique = {}
    for profile in sorted(candidates, key=lambda p: p['path']):
        existing = unique.get(profile['uuid'])
        if existing and any(existing[key] != profile[key] for key in ('name', 'expires', 'certificate_sha1')):
            return None, ['Conflicting installed copies of a provisioning profile.']
        unique.setdefault(profile['uuid'], profile)
    if len(unique) != 1:
        return None, ['Select an exact App Store profile UUID; expected one eligible profile, found ' + str(len(unique)) + '.']
    selected = next(iter(unique.values()))
    return {key: selected[key] for key in ('uuid', 'name', 'path', 'certificate_sha1')}, []


def write_report(destination, report):
    """Replace the chosen report atomically, without following its final symlink.

    A rerun may replace an existing report. A private sibling file keeps partial
    output and provisioning metadata from becoming readable during that write.
    """
    destination = Path(destination)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                         prefix='.release-preflight-', suffix='.json',
                                         dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(report, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'report', 'revision', 'bundle-id', 'team'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--stage', choices=['candidate', 'distribution'], default='distribution')
    parser.add_argument('--profile', help='Exact installed App Store provisioning profile UUID')
    parser.add_argument('--entitlement', action='append', default=[], choices=sorted(OPTIONAL_ENTITLEMENTS),
                        help='Also require an optional capability; repeat for each')
    args = parser.parse_args()
    required = required_entitlements(args.entitlement)
    if args.profile:
        try:
            args.profile = str(uuid.UUID(args.profile)).upper()
        except ValueError:
            parser.error('--profile must be a UUID, not a profile name')
    source = Path(args.source).resolve()
    head = command('git', '-C', str(source), 'rev-parse', '--verify', 'HEAD^{commit}')
    expected = command('git', '-C', str(source), 'rev-parse', '--verify', '--end-of-options',
                       args.revision + '^{commit}')
    changes = command('git', '-C', str(source), 'status', '--porcelain').splitlines()
    refs = command('git', '-C', str(source), 'ls-remote', 'origin', 'refs/heads/main').split()
    main_ref = refs[0] if refs else None
    blockers, notes = source_policy(head, expected, changes, main_ref, args.stage)
    if main_ref is None:
        blockers.append('Remote main could not be resolved.')
    identities = usable_identities(command('security', 'find-identity', '-v', '-p', 'codesigning'))
    profiles = []
    roots = [Path.home() / 'Library/MobileDevice/Provisioning Profiles',
             Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles']
    for root in roots:
        for path in sorted(root.glob('*.mobileprovision')):
            decoded = subprocess.run(['security', 'cms', '-D', '-i', str(path)], capture_output=True)
            if decoded.returncode:
                continue
            try:
                profile = plistlib.loads(decoded.stdout)
            except (plistlib.InvalidFileException, ValueError):
                continue
            if not isinstance(profile, dict):
                continue
            profiles.append(profile_result(profile, path, args.team, args.bundle_id, identities,
                                           datetime.datetime.now(datetime.timezone.utc), required))
    selected, selection_errors = select_profile(profiles, args.profile)
    blockers.extend(selection_errors)
    report = {'status': 'blocked' if blockers else 'prerequisites_present', 'stage': args.stage,
              'source': str(source), 'revision': head, 'remote_main': main_ref,
              'remote_main_matches': head == main_ref, 'upload_performed': False,
              'uncommitted_files': changes, 'bundle_id': args.bundle_id, 'team': args.team,
              'required_entitlements': required, 'selected_profile': selected,
              'matching_profiles': profiles, 'blockers': blockers, 'notes': notes,
              'not_verified': ['archive signature', 'export', 'release tests', 'physical acceptance']}
    destination = Path(args.report)
    destination.parent.mkdir(parents=True, exist_ok=True)
    write_report(destination, report)
    print(json.dumps(report, indent=2))
    return 1 if blockers else 0


if __name__ == '__main__':
    raise SystemExit(main())
