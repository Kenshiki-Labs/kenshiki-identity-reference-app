#!/usr/bin/env python3
"""Verify a generated host's exact installed artifact, suite inventory and executed tests.

Run from the delivered host, not an SDK source checkout. Native execution is opt-in and selects
only ArtifactNativeTests, a public native API/configuration lane with no UI automation.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

PREFIX = 'Examples/ReactNativeCaptureHost/'
PACKAGE = 'node_modules/@kenshiki/identity-capture'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stream_digest(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def file_digest(path):
    with path.open('rb') as stream:
        return stream_digest(stream)


def local_file(root, relative):
    path = PurePosixPath(relative)
    if not path.parts or path.is_absolute() or '..' in path.parts or '\\' in relative or str(path) != relative:
        raise ValueError('Invalid manifest path: ' + relative)
    if any(root.joinpath(*path.parts[:index]).is_symlink() for index in range(1, len(path.parts) + 1)):
        raise ValueError('Linked input is not an independent installation: ' + relative)
    result = root / relative
    if not result.is_file():
        raise ValueError('Missing installed input: ' + relative)
    return result


def inspect_inputs(host):
    manifest_path = local_file(host, 'vendor/integration-manifest.json')
    manifest = json.loads(manifest_path.read_text())
    name = manifest['sdkArtifact']
    if Path(name).name != name or '\\' in name:
        raise ValueError('Artifact name must be a filename')
    artifact = local_file(host, 'vendor/' + name)
    artifact_hash = file_digest(artifact)
    if artifact_hash != manifest['sdkArtifactSHA256']:
        raise ValueError('Retained tarball differs from the delivery manifest')
    inputs = {'vendor/integration-manifest.json': digest(manifest_path.read_bytes()),
              'vendor/' + name: artifact_hash}
    with tarfile.open(artifact, 'r:gz') as archive:
        names = archive.getnames()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate tarball members')
        files = {}
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile() or not member.name.startswith('package/'):
                raise ValueError('Tarball contains a nonregular package member')
            relative = member.name[len('package/'):]
            installed = local_file(host, PACKAGE + '/' + relative)
            with archive.extractfile(member) as stream:
                expected = stream_digest(stream)
            actual = file_digest(installed)
            if actual != expected:
                raise ValueError('Installed package differs from the tarball: ' + relative)
            files[relative] = expected
            inputs[PACKAGE + '/' + relative] = actual
        binary = json.load(archive.extractfile('package/build-manifest.json'))
        if binary['sdkCommit'] != manifest['sdkBinarySourceCommit']:
            raise ValueError('Binary source identity differs from the delivery')
        for relative, expected in binary['fileSHA256'].items():
            if files.get(relative) != expected:
                raise ValueError('Binary file manifest mismatch: ' + relative)
    # An extra .js file can shadow an unchanged delivered .ts file. npm may install nested
    # dependencies in node_modules; they are separate packages described by the host lockfile.
    package_root = host / PACKAGE
    for installed in package_root.rglob('*'):
        relative = installed.relative_to(package_root).as_posix()
        if relative.startswith('node_modules/'):
            continue
        if (installed.is_file() or installed.is_symlink()) and relative not in files:
            raise ValueError('Unlisted installed package file: ' + relative)
    sources_path = local_file(host, 'vendor/reference-sources.json')
    sources = json.loads(sources_path.read_text())
    inputs['vendor/reference-sources.json'] = digest(sources_path.read_bytes())
    suites = []
    source_names = set()
    for name, expected in manifest['fileSHA256'].items():
        if not name.startswith(PREFIX):
            continue
        relative = name[len(PREFIX):]
        if Path(relative).suffix not in {'.ts', '.tsx'}:
            continue
        source_names.add(relative)
        original = sources.get(relative)
        if not isinstance(original, str) or digest(original.encode()) != expected:
            raise ValueError('Retained reference source differs from the delivery: ' + relative)
        rewritten = re.sub(r'(?:\.\./)+ReactNative/identity-capture/src(?=/|[\'\"])',
                           '@kenshiki/identity-capture/src', original).encode()
        data = local_file(host, relative).read_bytes()
        if data != rewritten:
            raise ValueError('Generated module differs from the delivered source: ' + relative)
        inputs[relative] = digest(data)
        if re.search(rb'(?:\.\./)+ReactNative/identity-capture/src', data):
            raise ValueError('Generated module still refers to a source checkout: ' + relative)
        if re.search(r'\.test\.tsx?$', relative):
            suites.append(relative)
    if set(sources) != source_names:
        raise ValueError('Retained reference source inventory differs from the delivery')
    if not suites:
        raise ValueError('Delivery contains no reference-host suites')
    for relative in ['package-lock.json', 'package.json', 'jest.config.js', 'tsconfig.json']:
        inputs[relative] = digest(local_file(host, relative).read_bytes())
    for name in ['ArtifactNativeTests.swift', 'NativeArtifactTestHost.swift']:
        expected = manifest['fileSHA256'].get(PREFIX + name)
        if expected is not None:
            relative = 'ios/' + name
            actual = digest(local_file(host, relative).read_bytes())
            if actual != expected:
                raise ValueError('Native test source differs from the delivery: ' + name)
            inputs[relative] = actual
    for relative in ['ios/IdentitySDKHost.xcodeproj/project.pbxproj',
                     'ios/IdentitySDKHost.xcodeproj/xcshareddata/xcschemes/ArtifactNative.xcscheme',
                     'ios/Podfile', 'ios/Podfile.lock']:
        if (host / relative).exists():
            inputs[relative] = digest(local_file(host, relative).read_bytes())
    return manifest, sorted(suites), inputs


def suite_paths(host, paths):
    result = []
    for path in paths:
        absolute = Path(path)
        if not absolute.is_absolute():
            raise ValueError('Jest suite path must be absolute')
        try:
            result.append(absolute.relative_to(host).as_posix())
        except ValueError:
            raise ValueError('Jest executed a suite outside the independent host')
    if len(result) != len(set(result)):
        raise ValueError('Duplicate Jest suite paths')
    return sorted(result)


def require_inventory(host, expected, paths):
    actual = suite_paths(host, paths)
    if actual != expected:
        raise ValueError('Jest suite inventory differs; missing=' + str(sorted(set(expected) - set(actual))) +
                         '; unexpected=' + str(sorted(set(actual) - set(expected))))


def inspect_jest(host, expected, report):
    require_inventory(host, expected, [item['name'] for item in report['testResults']])
    if report.get('success') is not True or report.get('numFailedTests') != 0 or report.get('numFailedTestSuites') != 0:
        raise ValueError('Installed Jest execution failed')
    if report.get('numTotalTestSuites') != len(expected) or report.get('numTotalTests', 0) <= 0:
        raise ValueError('Jest totals do not describe the expected executed suites')
    if any(item.get('status') != 'passed' or not item.get('assertionResults') for item in report['testResults']):
        raise ValueError('A delivered Jest suite did not execute successfully')
    return {key: report[key] for key in ['numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites',
            'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests']}


def inspect_native(host, summary):
    source = local_file(host, 'ios/ArtifactNativeTests.swift').read_text()
    expected = re.findall(r'^  func (test\w+)\(', source, re.M)
    if not expected or len(expected) != len(set(expected)):
        raise ValueError('Native test source does not declare a unique method inventory')
    if (summary.get('result') != 'Passed' or summary.get('failedTests') != 0
            or summary.get('skippedTests') != 0 or summary.get('passedTests') != len(expected)
            or summary.get('totalTestCount') != len(expected)):
        raise ValueError('Native unit execution did not run every delivered method without skips')
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='new private receipt directory')
    parser.add_argument('--simulator', help='optional iPhone simulator UUID for public native unit tests')
    args = parser.parse_args()
    host = args.host.resolve()
    output = args.output.resolve()
    if output.exists():
        parser.error('Choose a new output directory')
    output.mkdir(parents=True)
    receipt = {'schemaVersion': 1, 'status': 'failed', 'host': str(host), 'commands': [],
               'scope': 'installed TypeScript/Jest and optional public native API configuration; no UI or live reader/service acceptance'}

    def run(command, log):
        with (output / log).open('w') as stream:
            result = subprocess.run(command, cwd=host, stdout=stream, stderr=subprocess.STDOUT)
        receipt['commands'].append({'argv': command, 'exitCode': result.returncode, 'log': log})
        if result.returncode:
            raise ValueError('Command failed; see ' + log)

    try:
        manifest, expected, before = inspect_inputs(host)
        receipt.update({'artifactSHA256': manifest['sdkArtifactSHA256'], 'sdkCommit': manifest['sdkBinarySourceCommit'],
                        'expectedSuites': expected, 'inputsBefore': before})
        for command, name in [(['node', '--version'], 'node-version.log'), (['npm', '--version'], 'npm-version.log'),
                              (['xcodebuild', '-version'], 'xcode-version.log')]:
            run(command, name)
        # A mapper could make every test pass against a checkout instead of the installed package.
        run(['node', '-e', "const c=require('./jest.config.js'); if(c.moduleNameMapper) process.exit(1); "
             "console.log(require.resolve('@kenshiki/identity-capture'));"], 'module-resolution.log')
        resolved = (output / 'module-resolution.log').read_text().strip()
        if resolved != str(host / PACKAGE / 'src/index.tsx'):
            raise ValueError('Node resolved a different SDK entry point')
        run(['npx', '--no-install', 'tsc', '--noEmit'], 'typecheck.log')
        run(['npx', '--no-install', 'jest', '--listTests', '--json', '--runInBand'], 'suite-discovery.json')
        require_inventory(host, expected, json.loads((output / 'suite-discovery.json').read_text()))
        run(['npx', '--no-install', 'jest', '--runInBand', '--json', '--outputFile', str(output / 'jest-results.json')], 'jest.log')
        receipt['jest'] = inspect_jest(host, expected, json.loads((output / 'jest-results.json').read_text()))
        if args.simulator:
            result = output / 'native-unit.xcresult'
            run(['xcodebuild', 'test', '-workspace', 'ios/IdentitySDKHost.xcworkspace', '-scheme', 'ArtifactNative',
                 '-destination', 'platform=iOS Simulator,id=' + args.simulator,
                 '-derivedDataPath', str(output / 'DerivedData'), '-resultBundlePath', str(result),
                 '-only-testing:ArtifactNativeTests', '-parallel-testing-enabled', 'NO',
                 '-collect-test-diagnostics', 'never', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-'], 'native-unit.log')
            run(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(result)], 'native-summary.json')
            summary = json.loads((output / 'native-summary.json').read_text())
            receipt['nativeExpectedMethods'] = inspect_native(host, summary)
            receipt['native'] = summary
        _, _, after = inspect_inputs(host)
        receipt['inputsAfter'] = after
        if before != after:
            raise ValueError('Installed inputs changed during execution')
        receipt['status'] = 'passed'
    except (KeyError, OSError, ValueError, tarfile.TarError) as error:
        receipt['failure'] = str(error)
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    if receipt['status'] != 'passed':
        raise SystemExit('Installed-host validation failed: ' + receipt['failure'])
    print('Installed-host receipt:', output / 'receipt.json')


if __name__ == '__main__':
    main()
