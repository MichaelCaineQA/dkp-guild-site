import importlib.machinery
import importlib.util
import hashlib
import json
import io
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
loader = importlib.machinery.SourceFileLoader('dkp_installer', str(Path(__file__).with_name('dkp')))
spec = importlib.util.spec_from_loader(loader.name, loader)
dkp = importlib.util.module_from_spec(spec)
loader.exec_module(dkp)


class InstallerTest(unittest.TestCase):
    def test_release_checks_files_digests_and_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = {'version': 'v1.2.3', 'repository': 'owner/repository',
                       'images': {'api': 'ghcr.io/owner/api@sha256:' + 'a' * 64,
                                  'web': 'ghcr.io/owner/web@sha256:' + 'b' * 64},
                       'platforms': ['linux/amd64']}
            (root / 'release-manifest.json').write_text(json.dumps(release))
            for name in ('dkp', 'Caddyfile', 'compose.yml', 'README.md'):
                (root / name).write_text(name)
            entries = ['dkp', 'Caddyfile', 'compose.yml', 'README.md', 'release-manifest.json']
            (root / 'SHA256SUMS').write_text(''.join(
                hashlib.sha256((root / name).read_bytes()).hexdigest() + '  ' + name + '\n'
                for name in entries))
            with patch.object(dkp, 'ROOT', root), patch.object(dkp, 'MANIFEST', root / 'release-manifest.json'), \
                 patch.object(dkp.os, 'uname', return_value=types.SimpleNamespace(machine='x86_64'), create=True):
                self.assertEqual(dkp.verify_release(), release)
                (root / 'compose.yml').write_text('tampered')
                with self.assertRaisesRegex(dkp.Failure, 'сумма'):
                    dkp.verify_release()

    def test_atomic_config_and_env_keep_special_characters(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            config = {
                'domain': 'example.com', 'guild': 'Гильдия', 'db_password': 'abcd',
                'session_secret': 'abcd', 'checkin_key': 'abcd', 'admin_login': 'admin',
                'admin_password': "a'$\\b", 'discord_id': '', 'discord_secret': '',
            }
            release = {'images': {'api': 'api@sha256:' + 'a' * 64, 'web': 'web@sha256:' + 'b' * 64}}
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'ENV', state / 'compose.env'):
                dkp.atomic_json(state / 'config.json', config)
                values = dkp.env_file(config, release)
                self.assertEqual(json.loads((state / 'config.json').read_text(encoding='utf-8')), config)
                self.assertEqual(values['DKP_ADMIN_PASSWORD'], config['admin_password'])
                self.assertEqual((state / 'compose.env').read_text(encoding='utf-8'), '')
                if os.name != 'nt':
                    self.assertEqual((state / 'compose.env').stat().st_mode & 0o777, 0o600)
                if shutil.which('docker'):
                    for password in ("a'$\\b", "before\\'after", 'trailing\\', "''", '$$'):
                        config['admin_password'] = password
                        values = dkp.env_file(config, release)
                        result = subprocess.run(['docker', 'compose', '--env-file', str(state / 'compose.env'),
                                                 '-f', str(Path(__file__).with_name('compose.yml')),
                                                 'config', '--format', 'json'], capture_output=True, check=True,
                                                env={**os.environ, **values})
                        parsed = json.loads(result.stdout)
                        self.assertEqual(parsed['services']['api']['environment']['ADMIN_PASSWORD'].replace('$$', '$'),
                                         password)

    def test_backup_mac_detects_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'backup.enc'
            path.write_bytes(b'encrypted data')
            expected = dkp.mac_file(path, b'recovery key')
            path.write_bytes(b'encrypted datA')
            self.assertNotEqual(expected, dkp.mac_file(path, b'recovery key'))
            self.assertNotEqual(expected, dkp.mac_file(path, b'another key'))

    def test_env_rejects_newline(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            config = {'domain': 'x\ny', 'guild': 'g', 'db_password': 'x', 'session_secret': 'x',
                      'checkin_key': 'x', 'admin_login': 'a', 'admin_password': 'p'}
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'ENV', state / 'compose.env'):
                with self.assertRaises(dkp.Failure):
                    dkp.env_file(config, {'images': {'api': 'x', 'web': 'y'}})
                self.assertFalse((state / 'compose.env').exists())

    def test_backup_stops_only_running_api_and_stores_only_encrypted_bundle(self):
        openssl = shutil.which('openssl')
        if not openssl:
            self.skipTest('openssl is required')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, dest = root / 'state', root / 'remote'
            state.mkdir()
            dest.mkdir()
            key = root / 'key'
            key.write_text('independent-recovery-secret\n')
            config_path = state / 'config.json'
            manifest_path = root / 'manifest.json'
            c = {'backup': {'mode': 'local', 'target': str(dest), 'key': str(key), 'retention_days': 30},
                 'admin_password': 'private-password'}
            config_path.write_text(json.dumps(c))
            manifest_path.write_text('{"version":"v1.0.0"}')
            calls = []
            def fake_compose(_c, _release, *args, **kwargs):
                calls.append(args)
                if args[:2] == ('ps', '--status'):
                    return types.SimpleNamespace(stdout='api\n')
                if args[0] == 'exec':
                    kwargs['stdout'].write(b'fake-database-secret')
                if args[0] == 'run':
                    buffer = io.BytesIO()
                    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                        info = tarfile.TarInfo('screen.png')
                        info.size = 6
                        archive.addfile(info, io.BytesIO(b'screen'))
                    kwargs['stdout'].write(buffer.getvalue())
                return types.SimpleNamespace(stdout='')
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'CONFIG', config_path), \
                 patch.object(dkp, 'MANIFEST', manifest_path), patch.object(dkp, 'compose', fake_compose):
                dkp.backup_now(c, {'version': 'v1.0.0'})
            backups = list(dest.glob('*.enc'))
            self.assertEqual(len(backups), 1)
            self.assertNotIn(b'private-password', backups[0].read_bytes())
            self.assertNotIn(b'fake-database-secret', backups[0].read_bytes())
            self.assertEqual(backups[0].with_suffix('.hmac').read_text().strip(),
                             dkp.mac_file(backups[0], key.read_bytes().strip()))
            self.assertIn(('stop', 'api'), calls)
            self.assertEqual(calls[-1], ('start', 'api'))

    def test_failed_backup_does_not_rotate_existing_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            folder = state / 'backups'
            folder.mkdir()
            previous = folder / '20200101T000000000000Z.enc'
            previous.write_bytes(b'previous')
            c = {'backup': {'mode': 'local', 'target': str(state), 'key': 'unused', 'retention_days': 30}}
            calls = []
            def fake_compose(_c, _r, *args, **kwargs):
                calls.append(args)
                if args[0] == 'ps':
                    return types.SimpleNamespace(stdout='api\n')
                if args[0] == 'exec':
                    raise dkp.Failure('pg_dump failed')
                return types.SimpleNamespace(stdout='')
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'compose', fake_compose):
                with self.assertRaises(dkp.Failure):
                    dkp.backup_now(c, {})
            self.assertTrue(previous.exists())
            self.assertEqual(calls[-1], ('start', 'api'))

    def test_restore_checks_signature_before_any_database_action(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            folder = state / 'backups'
            folder.mkdir()
            key = state / 'key'
            key.write_text('recovery-key\n')
            (folder / '20261108T123456123456Z.enc').write_bytes(b'modified backup')
            (folder / '20261108T123456123456Z.hmac').write_text('0' * 64)
            c = {'backup': {'mode': 'local', 'key': str(key), 'target': str(state)}}
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'compose') as compose:
                with self.assertRaisesRegex(dkp.Failure, 'целостности'):
                    dkp.backup_restore(c, {'version': 'v1.0.0'}, '20261108T123456123456Z')
                compose.assert_not_called()

    def test_restore_rejects_unsafe_ids_before_any_database_action(self):
        with patch.object(dkp, 'compose') as compose:
            with self.assertRaises(dkp.Failure):
                dkp.backup_restore({}, {}, '../another-folder')
            compose.assert_not_called()

    def test_failed_migration_blocks_start_before_docker_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / 'migration-failed').write_text('v2.0.0')
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'compose') as compose:
                with self.assertRaisesRegex(dkp.Failure, 'миграци'):
                    dkp.start({}, {'version': 'v1.0.0'})
                compose.assert_not_called()

    def test_backup_restore_roundtrip_prepares_separate_backup_and_restores_key(self):
        if not shutil.which('openssl'):
            self.skipTest('openssl is required')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / 'state'
            state.mkdir()
            storage = root / 'storage'
            storage.mkdir()
            key = root / 'recovery.key'
            key.write_text('recovery-key\n')
            config_path = state / 'config.json'
            manifest_path = root / 'release-manifest.json'
            release = {'version': 'v1.0.0'}
            manifest_path.write_text(json.dumps(release))
            c = {'domain': 'example.com', 'checkin_key': 'a' * 64, 'admin_password': 'private',
                 'backup': {'mode': 'local', 'target': str(storage), 'key': str(key), 'retention_days': 30}}
            config_path.write_text(json.dumps(c))
            calls = []
            def fake_compose(_c, _release, *args, **kwargs):
                calls.append(args)
                if args[0] == 'ps':
                    return types.SimpleNamespace(stdout='api\n')
                if args[0] == 'exec' and 'sh' in args:
                    kwargs['stdout'].write(b'database dump')
                if args[0] == 'run' and 'stdout' in kwargs:
                    buffer = io.BytesIO()
                    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                        item = tarfile.TarInfo('screen.png')
                        item.size = 6
                        archive.addfile(item, io.BytesIO(b'screen'))
                    kwargs['stdout'].write(buffer.getvalue())
                if args[0] == 'run' and 'stdin' in kwargs:
                    self.assertTrue(kwargs['stdin'].read())
                return types.SimpleNamespace(stdout='')
            with patch.object(dkp, 'STATE', state), patch.object(dkp, 'ROOT', root), \
                 patch.object(dkp, 'CONFIG', config_path), patch.object(dkp, 'MANIFEST', manifest_path), \
                 patch.object(dkp, 'compose', fake_compose), patch.object(dkp, 'check_https'), \
                 patch.object(dkp, 'prompt', return_value='example.com'):
                dkp.backup_now(c, release)
                first = next(storage.glob('*.enc')).stem
                c['checkin_key'] = 'b' * 64
                dkp.backup_restore(c, release, first)
            self.assertEqual(c['checkin_key'], 'a' * 64)
            self.assertEqual(json.loads(config_path.read_text())['checkin_key'], 'a' * 64)
            self.assertEqual(len(list(storage.glob('*.enc'))), 2)
            self.assertTrue(any('DROP DATABASE dkp' in args for args in calls))
            self.assertFalse((state / 'migration-failed').exists())


if __name__ == '__main__':
    unittest.main()
