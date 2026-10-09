"""Portable helper checks; uses real Git and a materialized, isolated delivery copy."""
import importlib.util
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


if __name__ == '__main__':
    unittest.main()
