"""Portable helper checks; uses real Git and a materialized, isolated delivery copy."""
import importlib.util
import io
import json
import tarfile
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('adopter_release', HERE / 'adopter_release.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class AdopterTests(unittest.TestCase):
    def test_clean_pinned_app_and_dirty_wrong_revision_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Test')
            (repo / 'App.tsx').write_text('source')
            git('add', 'App.tsx')
            git('commit', '-m', 'test app source')
            revision = git('rev-parse', 'HEAD')
            a.check_source(repo, revision)
            with self.assertRaises(ValueError):
                a.check_source(repo, '0' * 40)
            (repo / 'App.tsx').write_text('changed')
            with self.assertRaises(ValueError):
                a.check_source(repo, revision)
            git('checkout', '--', 'App.tsx')
            (repo / 'new-source.ts').write_text('uncommitted')
            with self.assertRaises(ValueError):
                a.check_source(repo, revision)

    def test_materialized_helpers_need_no_publisher_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ('adopter_release.py', 'verify_export.py', 'release_preflight.py', 'configure_release.rb'):
                (target / name).write_bytes((HERE / name).read_bytes())
                self.assertFalse((target / name).is_symlink())
            for helper in ('adopter_release.py', 'verify_export.py'):
                completed = subprocess.run([sys.executable, str(target / helper), '--help'], cwd=target,
                                           capture_output=True, text=True)
                self.assertEqual(completed.returncode, 0, completed.stderr)
            completed = subprocess.run(['ruby', '-c', str(target / 'configure_release.rb')], capture_output=True)
            self.assertEqual(completed.returncode, 0)


class InstalledSDKTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.host = Path(self.temporary.name)
        self.installed = self.host / 'node_modules/@kenshiki/identity-capture'
        self.installed.mkdir(parents=True)
        self.file = self.installed / 'src/index.ts'
        self.file.parent.mkdir()
        self.file.write_text('export const sdk = true;')
        self.manifest = {'sdkCommit': 'a' * 40, 'fileSHA256': {'src/index.ts': a.sha256(self.file)}}
        self.artifact = self.host / 'sdk.tgz'
        self.write_archive()

    def write_archive(self):
        content = json.dumps(self.manifest).encode()
        (self.installed / 'build-manifest.json').write_bytes(content)
        with tarfile.open(self.artifact, 'w:gz') as archive:
            member = tarfile.TarInfo('package/build-manifest.json')
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        self.reference = {'sdkArtifactSHA256': a.sha256(self.artifact), 'sdkBinarySourceCommit': 'a' * 40}

    def verify(self):
        return a.verified_sdk(self.host, self.artifact, self.reference)

    def test_original_sdk_is_verified_and_every_file_returned(self):
        manifest, files = self.verify()
        self.assertEqual(manifest, self.manifest)
        self.assertIn(self.file, files)
        self.assertIn(self.installed / 'build-manifest.json', files)

    def test_changed_sdk_file_refused_even_when_commit_unchanged(self):
        self.file.write_text('changed executable code')
        with self.assertRaises(ValueError):
            self.verify()

    def test_changed_manifest_and_self_consistent_file_hash_refused(self):
        self.file.write_text('changed executable code')
        self.manifest['fileSHA256']['src/index.ts'] = a.sha256(self.file)
        (self.installed / 'build-manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError):
            self.verify()

    def test_archive_mutation_refused(self):
        self.artifact.write_bytes(b'changed archive')
        with self.assertRaises(ValueError):
            self.verify()

    def test_inventory_traversal_and_symlink_escape_refused(self):
        outside = self.host / 'outside'
        outside.write_text('outside')
        (self.installed / 'escape').symlink_to(outside)
        for name in ('../outside', str(outside), 'escape'):
            with self.subTest(name=name):
                self.manifest['fileSHA256'] = {name: a.sha256(outside)}
                self.write_archive()
                with self.assertRaises(ValueError):
                    self.verify()

    def test_freeze_records_installed_sdk_and_refuses_subsequent_mutation(self):
        subprocess.run(['git', 'init', '--quiet', str(self.host)], check=True)
        delivery = self.host / 'vendor'
        delivery.mkdir()
        (delivery / 'integration-manifest.json').write_text(json.dumps(self.reference))
        (self.host / 'ios/Pods').mkdir(parents=True)
        (self.host / 'ios/Podfile.lock').write_text('pods')
        (self.host / 'ios/Pods/Manifest.lock').write_text('pods')
        inputs = {'host': str(self.host), 'delivery': str(delivery), 'sdkArtifact': str(self.artifact),
                  'referenceManifestSHA256': a.sha256(delivery / 'integration-manifest.json')}
        (self.host / 'inputs.json').write_text(json.dumps(inputs))
        a.freeze(self.host)
        frozen = json.loads((self.host / 'inputs.json').read_text())
        self.assertEqual(frozen['inputSHA256'][str(self.file)], a.sha256(self.file))
        self.file.write_text('changed after prepare')
        with self.assertRaises(ValueError):
            a.freeze(self.host)


if __name__ == '__main__':
    unittest.main()
