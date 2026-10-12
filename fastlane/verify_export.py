#!/usr/bin/env python3
"""Verify actual signed App Store archive/export; this is not device acceptance."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import subprocess
import tempfile
import zipfile


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def resource_inclusion(manifest):
    """Decode declared resource inclusion without inventing facts absent from older artifacts.

    Schema 2 used modelsIncluded for adopter-supplied face models and had no Regula declarations.
    Schema 3 names that scope explicitly and requires the two vendor-input declarations.
    """
    version = manifest.get('schemaVersion')
    require(type(version) is int and version in (2, 3), 'Unsupported SDK manifest schema')
    fields = ['trustAnchorsIncluded']
    if version == 3:
        require('modelsIncluded' not in manifest, 'Schema 3 cannot contain the obsolete modelsIncluded field')
        fields += ['faceModelsIncluded', 'regulaLicenseIncluded', 'regulaDatabaseIncluded']
    else:
        fields += ['modelsIncluded']
    for field in fields:
        require(type(manifest.get(field)) is bool, 'Missing or malformed SDK inclusion flag: ' + field)
    if version == 2:
        return {'faceModelsIncluded': manifest['modelsIncluded'],
                'trustAnchorsIncluded': manifest['trustAnchorsIncluded'],
                'regulaLicenseIncluded': 'not_reported', 'regulaDatabaseIncluded': 'not_reported'}
    return {field: manifest[field] for field in fields}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def run(*args):
    result = subprocess.run(args, capture_output=True, check=False)
    require(result.returncode == 0, f'{args[0]} verification command failed: '
            + result.stderr.decode(errors='replace')[:1500])
    return result.stdout


def validate_metadata(info, inputs):
    expected = {
        'CFBundleIdentifier': inputs['bundleIdentifier'],
        'CFBundleShortVersionString': inputs['version'],
        'CFBundleVersion': inputs['buildNumber'],
        'AppSourceRevision': inputs['sourceRevision'],
        'SDKSourceRevision': inputs.get('sdkBinarySourceCommit', inputs['sourceRevision']),
        'SDKArtifactSHA256': inputs['sdkArtifactSHA256'],
        'SDKReferenceManifestSHA256': inputs['referenceManifestSHA256'],
    }
    for key, value in expected.items():
        require(info.get(key) == str(value), f'Info.plist mismatch: {key}')
    executable = info.get('CFBundleExecutable')
    require(isinstance(executable, str) and executable and
            PurePosixPath(executable).name == executable and executable not in ('.', '..'),
            'Invalid app executable path')
    require(info.get('CFBundleSupportedPlatforms') == ['iPhoneOS'], 'App is not an iPhoneOS build')


def validate_profile(profile, preflight, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    entitlements = profile.get('Entitlements', {})
    selected = preflight['selected_profile']
    require(str(profile.get('UUID')).upper() == selected['uuid'].upper(), 'Unexpected provisioning profile UUID')
    require(profile.get('Name') == selected['name'], 'Unexpected provisioning profile name')
    require(profile.get('TeamIdentifier') == [preflight['team']], 'Unexpected profile team')
    require('ProvisionedDevices' not in profile and not profile.get('ProvisionsAllDevices'),
            'Profile is not App Store distribution')
    require(entitlements.get('get-task-allow') is False, 'Profile permits debugging')
    require(entitlements.get('beta-reports-active') is True, 'Profile lacks App Store beta entitlement')
    expected_id = preflight['team'] + '.' + preflight['bundle_id']
    require(entitlements.get('application-identifier') == expected_id, 'Profile app identifier mismatch')
    expiry = profile.get('ExpirationDate')
    require(isinstance(expiry, dt.datetime), 'Profile expiration missing')
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=dt.timezone.utc)
    require(expiry > now, 'Provisioning profile expired')
    certificates = {hashlib.sha1(cert, usedforsecurity=False).hexdigest().upper() for cert in profile.get('DeveloperCertificates', [])}
    require(selected['certificate_sha1'].upper() in certificates, 'Profile certificate mismatch')
    for key, wanted in preflight['required_entitlements'].items():
        actual = entitlements.get(key)
        if isinstance(wanted, list):
            require(isinstance(actual, list) and all(x in actual for x in wanted), f'Profile lacks {key}')
        elif isinstance(actual, list):
            require(wanted in actual, f'Profile lacks {key}')
        else:
            require(actual == wanted, f'Profile lacks {key}')


def validate_signed_entitlements(entitlements, preflight):
    require(entitlements.get('get-task-allow', False) is False, 'Signed app permits debugging')
    require(entitlements.get('application-identifier') == preflight['team'] + '.' + preflight['bundle_id'],
            'Signed app identifier mismatch')
    require(entitlements.get('com.apple.developer.team-identifier') == preflight['team'],
            'Signed app team mismatch')
    for key, wanted in preflight['required_entitlements'].items():
        actual = entitlements.get(key)
        if isinstance(wanted, list):
            require(isinstance(actual, list) and all(x in actual for x in wanted), f'Signed app lacks {key}')
        else:
            require(actual == wanted, f'Signed app lacks {key}')


def validate_javascript(archive_hash, export_hash):
    require(archive_hash == export_hash, 'JavaScript changed between archive and export')


def extract_ipa(ipa, destination):
    with zipfile.ZipFile(ipa) as zipped:
        seen = set()
        for member in zipped.infolist():
            path = PurePosixPath(member.filename)
            require(member.filename and not path.is_absolute() and '..' not in path.parts
                    and '\\' not in member.filename, 'Unsafe IPA member path')
            require(path.as_posix() not in seen, 'Duplicate IPA member')
            seen.add(path.as_posix())
            mode = member.external_attr >> 16
            require(not stat.S_ISLNK(mode), 'IPA symbolic links are not supported')
            zipped.extract(member, destination)
            extracted = destination.joinpath(*path.parts)
            if mode and extracted.is_file():
                extracted.chmod(stat.S_IMODE(mode))
    apps = list((destination / 'Payload').glob('*.app'))
    require(len(apps) == 1 and apps[0].is_dir(), 'IPA must contain exactly one Payload app')
    return apps[0]


def verify_binary(binary):
    archs = run('xcrun', 'lipo', '-archs', str(binary)).decode().split()
    require('arm64' in archs and set(archs) <= {'arm64', 'arm64e'}, f'Non-device architecture: {binary.name}')
    platform_output = run('xcrun', 'vtool', '-show-build', str(binary)).decode()
    platforms = re.findall(r'^\s*platform\s+(\S+)', platform_output, re.M)
    require(platforms and all(p == 'IOS' for p in platforms), f'Non-iOS Mach-O platform: {binary.name}')


def verify_app(app, inputs, preflight, scratch):
    scratch.mkdir(parents=True, exist_ok=True)
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app))
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    validate_metadata(info, inputs)
    profile = plistlib.loads(run('/usr/bin/security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')))
    validate_profile(profile, preflight)
    entitlements = plistlib.loads(run('/usr/bin/codesign', '-d', '--entitlements', ':-', str(app)))
    validate_signed_entitlements(entitlements, preflight)
    prefix = str(scratch / 'signer')
    run('/usr/bin/codesign', '-d', '--extract-certificates', prefix, str(app))
    actual_cert = hashlib.sha1(Path(prefix + '0').read_bytes(), usedforsecurity=False).hexdigest().upper()
    require(actual_cert == preflight['selected_profile']['certificate_sha1'].upper(), 'Actual signing certificate mismatch')
    verify_binary(app / info['CFBundleExecutable'])
    for framework in app.rglob('*.framework'):
        framework_info = plistlib.loads((framework / 'Info.plist').read_bytes())
        binary_name = framework_info.get('CFBundleExecutable')
        require(isinstance(binary_name, str) and PurePosixPath(binary_name).name == binary_name,
                'Invalid framework executable')
        verify_binary(framework / binary_name)
    for dylib in app.rglob('*.dylib'):
        verify_binary(dylib)
    privacy = plistlib.loads((app / 'PrivacyInfo.xcprivacy').read_bytes())
    require(isinstance(privacy, dict), 'App privacy manifest must be a plist dictionary')
    js = app / 'main.jsbundle'
    require(js.is_file() and js.stat().st_size > 0, 'Embedded JavaScript bundle missing or empty')
    encryption = info.get('ITSAppUsesNonExemptEncryption')
    require(encryption is None or isinstance(encryption, bool), 'Malformed encryption declaration')
    return {'jsBundleSHA256': sha256(js), 'encryptionDeclaration':
            {'status': 'not_declared' if encryption is None else 'declared', 'usesNonExemptEncryption': encryption}}


def verify(archive, ipa, preflight, inputs):
    require(preflight.get('status') == 'prerequisites_present', 'Preflight did not pass')
    require(preflight.get('revision') == inputs['sourceRevision'], 'Preflight source revision mismatch')
    require(inputs['bundleIdentifier'] == preflight['bundle_id'], 'Input/preflight bundle mismatch')
    require(sha256(inputs['sdkArtifact']) == inputs['sdkArtifactSHA256'], 'SDK artifact hash mismatch')
    manifest = Path(inputs['delivery']) / 'integration-manifest.json'
    require(sha256(manifest) == inputs['referenceManifestSHA256'], 'Reference manifest hash mismatch')
    for path, digest in inputs['inputSHA256'].items():
        require(sha256(path) == digest, 'Release input changed: ' + path)
    build_manifest = json.loads((Path(inputs['host']) / 'node_modules/@kenshiki/identity-capture/build-manifest.json').read_text())
    inclusion = resource_inclusion(build_manifest)
    apps = list((archive / 'Products/Applications').glob('*.app'))
    require(len(apps) == 1, 'Archive must contain exactly one app')
    with tempfile.TemporaryDirectory(prefix='kenshiki-export-verify-') as tmp:
        root = Path(tmp)
        app = extract_ipa(ipa, root / 'export')
        archived = verify_app(apps[0], inputs, preflight, root / 'archive-signing')
        exported = verify_app(app, inputs, preflight, root / 'export-signing')
        validate_javascript(archived['jsBundleSHA256'], exported['jsBundleSHA256'])
        require(archived['encryptionDeclaration'] == exported['encryptionDeclaration'], 'Export encryption declaration changed')
        return {'status': 'verified', 'sourceRevision': inputs['sourceRevision'],
                'appSourceRevision': inputs['sourceRevision'],
                'sdkBinarySourceCommit': inputs.get('sdkBinarySourceCommit', inputs['sourceRevision']),
                'sdkArtifactSHA256': inputs['sdkArtifactSHA256'], 'ipaSHA256': sha256(ipa),
                'ipa': str(ipa.resolve()), 'archive': str(archive.resolve()),
                'bundleIdentifier': inputs['bundleIdentifier'], 'version': inputs['version'],
                'buildNumber': inputs['buildNumber'], **exported, **inclusion,
                'assurance': 'Signature, packaging and provenance verification only; no device or integration test claim.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('archive', 'ipa', 'preflight', 'inputs', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.archive, args.ipa, json.loads(args.preflight.read_text()), json.loads(args.inputs.read_text()))
    except (VerificationError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        result = {'status': 'failed', 'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0 if result['status'] == 'verified' else 1


if __name__ == '__main__':
    raise SystemExit(main())
