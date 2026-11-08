"""Exercise failure paths without Docker, SSH, a database or production secrets."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        source = Path(__file__).resolve().parent
        for name in ("deploy-prod.sh", "backup-prod.sh"):
            shutil.copyfile(source / name, self.root / "scripts" / name)
        (self.root / ".env.production").touch()
        self.log = self.root / "calls"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.executable("docker", '''#!/bin/sh
echo "$*" >> "$CALL_LOG"
case "$*" in
  *"exec -T db"*)
    [ "${FAIL:-}" != backup ] || exit 1
    printf 'database dump'
    ;;
  *"--entrypoint tar"*)
    [ "${FAIL:-}" != screenshots ] || exit 1
    printf 'screenshots archive'
    ;;
  *"prisma migrate deploy"*) [ "${FAIL:-}" != migration ] || exit 1 ;;
esac
''')
        self.executable("rsync", '''#!/bin/sh
echo "rsync $*" >> "$CALL_LOG"
[ "${FAIL:-}" != upload ]
''')
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "CALL_LOG": str(self.log),
            "BACKUP_DIR": str(self.root / "backups"),
            "BACKUP_REMOTE": "",
            "FAIL": "",
        }

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content, encoding="utf-8", newline="\n")
        path.chmod(0o755)

    def run_script(self, name="deploy-prod.sh", **env):
        return subprocess.run(
            ["sh", str(self.root / "scripts" / name)],
            env={**self.env, **env}, capture_output=True, text=True,
        )

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_snapshot_precedes_migration_and_restart(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = "\n".join(self.calls())
        order = ["stop api", "exec -T db", "--entrypoint tar", "prisma migrate deploy",
                 "dist-seed/prisma/seed.js", "up -d --wait api web caddy"]
        positions = [calls.index(step) for step in order]
        self.assertEqual(positions, sorted(positions))

    def test_failed_snapshot_restores_api_and_never_migrates(self):
        result = self.run_script(FAIL="backup")
        self.assertNotEqual(result.returncode, 0)
        calls = "\n".join(self.calls())
        self.assertIn("start api", calls)
        self.assertNotIn("prisma migrate deploy", calls)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_failed_migration_leaves_api_stopped(self):
        result = self.run_script(FAIL="migration")
        self.assertNotEqual(result.returncode, 0)
        calls = "\n".join(self.calls())
        self.assertIn("prisma migrate deploy", calls)
        self.assertNotIn("start api", calls)
        self.assertNotIn("up -d --wait api web caddy", calls)
        self.assertEqual(len(list((self.root / "backups").glob("*/database.dump"))), 1)

    def test_failed_screenshots_snapshot_prevents_migration(self):
        result = self.run_script(FAIL="screenshots")
        self.assertNotEqual(result.returncode, 0)
        calls = "\n".join(self.calls())
        self.assertIn("start api", calls)
        self.assertNotIn("prisma migrate deploy", calls)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_failed_upload_keeps_local_snapshot_and_returns_failure(self):
        result = self.run_script("backup-prod.sh", FAIL="upload",
                                 BACKUP_REMOTE="backup@example.net:/dedicated/backups")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rsync", "\n".join(self.calls()))
        self.assertEqual(len(list((self.root / "backups").glob("*/database.dump"))), 1)
        self.assertEqual(len(list((self.root / "backups").glob("*/screenshots.tar.gz"))), 1)

    def test_missing_env_stops_before_docker(self):
        (self.root / ".env.production").unlink()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
