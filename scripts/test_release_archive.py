"""Linux packaging acceptance: inspect the actual release tarball."""
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


@unittest.skipIf(os.name == "nt", "Release packaging targets Linux")
class ReleaseArchiveTest(unittest.TestCase):
    def test_packaged_installer_has_lf_and_verified_checksums(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as output:
            env = dict(os.environ, RELEASE_OUTPUT_DIR=output,
                       GITHUB_REPOSITORY_OWNER="Test", GITHUB_REPOSITORY="Test/repo")
            subprocess.run(["bash", str(root / "scripts/release/package.sh"), "v0.0.0-test",
                            "sha256:" + "a" * 64, "sha256:" + "b" * 64], env=env, check=True)
            with tarfile.open(Path(output) / "dkp-guild-site-v0.0.0-test.tar.gz") as archive:
                prefix = "dkp-guild-site-v0.0.0-test/"
                self.assertEqual({m.name.removeprefix(prefix) for m in archive.getmembers() if m.isfile()},
                                 {"dkp", "Caddyfile", "compose.yml", "README.md", "SHA256SUMS", "release-manifest.json"})
                for filename in ("dkp", "Caddyfile", "compose.yml"):
                    self.assertNotIn(b"\r", archive.extractfile(prefix + filename).read())
                self.assertTrue(archive.getmember(prefix + "dkp").mode & 0o100)
                archive.extractall(output, filter="data")
            bundle = Path(output) / "dkp-guild-site-v0.0.0-test"
            subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=bundle, check=True)
            subprocess.run(["python3", "dkp", "--help"], cwd=bundle, check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
