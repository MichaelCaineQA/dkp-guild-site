"""Release selection runs against real temporary Git repositories, without SSH."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ProductionTagTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.script = Path(__file__).resolve().parent / "select-production-tag.sh"
        self.git("init", "-b", "main")
        self.git("config", "user.email", "release@example.test")
        self.git("config", "user.name", "Release test")
        self.git("commit", "--allow-empty", "-m", "main commit")
        self.main = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.main)
        self.git("tag", "v1.0.0")
        self.git("checkout", "-b", "feature")
        self.git("commit", "--allow-empty", "-m", "unmerged commit")
        self.feature = self.git("rev-parse", "HEAD")
        self.git("tag", "v-unmerged")

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL,
        ).strip()

    def select(self, tag="", ref="refs/heads/main"):
        return subprocess.run(
            ["sh", str(self.script)], cwd=self.root, capture_output=True, text=True,
            env={**os.environ, "RELEASE_TAG": tag, "GITHUB_REF": ref},
        )

    def test_explicit_tag_deploys_release_instead_of_dispatch_branch(self):
        result = self.select("v1.0.0", "refs/heads/feature")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.main)

    def test_tag_ref_can_be_dispatched_without_input(self):
        result = self.select(ref="refs/tags/v1.0.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.main)

    def test_branch_without_tag_is_rejected(self):
        result = self.select()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.feature)

    def test_tag_outside_main_is_rejected(self):
        result = self.select("v-unmerged")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.feature)

    def test_missing_tag_is_rejected_even_if_branch_exists(self):
        result = self.select("main")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.feature)

    def test_invalid_tag_is_rejected(self):
        result = self.select("../main")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), self.feature)
