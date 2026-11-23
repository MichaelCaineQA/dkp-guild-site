"""Verify a staging or offsite production backup in isolated Docker containers."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import tempfile
import time
import uuid


def run(*args, stdin=None):
    result = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args[0:2]}; exit {result.returncode}")
    return result.stdout


def restore_settings(backup, image, sha):
    if not image:
        if backup.parent != Path('/opt/dkp-guild-site/backups'):
            raise ValueError('Use a staging backup directory or specify a production image')
        config = json.loads(run('docker', 'inspect', 'dkp-guild-site-api-1'))[0]
        env = dict(value.split('=', 1) for value in config['Config']['Env'] if '=' in value)
        return config['Image'], env
    if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', image):
        raise ValueError('Use the immutable API image digest from the matching release')
    if not sha or not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Specify the full Git SHA of the matching release')
    manifest = json.loads((backup / 'verified.json').read_text(encoding='utf-8-sig'))
    observed_sha = manifest['observedServerCommit']
    if (manifest['environment'] != 'production' or manifest['backup'] != backup.name
            or not re.fullmatch(r'[0-9a-f]{12,40}', observed_sha)
            or not sha.startswith(observed_sha)):
        raise ValueError('Verified manifest and release SHA do not match')
    for name in ('database.dump', 'screenshots.tar.gz'):
        with (backup / name).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest['sha256'][name]:
                raise ValueError(f'Checksum mismatch: {name}')
    # Для учения свои credentials. Производственные секреты остаются в офлайн-хранилище.
    return image, dict(GIT_SHA=sha, SESSION_SECRET=secrets.token_hex(32),
                       ADMIN_LOGIN='restore-operator', ADMIN_PASSWORD=secrets.token_hex(24),
                       COOKIE_SECURE='true', SCREENSHOT_DIR='/app/uploads/screenshots')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("backup", type=Path)
    parser.add_argument("--production-image", help="API image pinned to a release digest")
    parser.add_argument("--release-sha", help="Full Git SHA corresponding to that release")
    args = parser.parse_args()
    backup = args.backup.resolve()
    started = time.monotonic()
    snapshot = datetime.strptime(backup.name, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    age_seconds = round((datetime.now(timezone.utc) - snapshot).total_seconds())
    prefix = 'dkp-restore-' + uuid.uuid4().hex[:10]
    network, database, api = prefix + '-net', prefix + '-db', prefix + '-api'
    image, env = restore_settings(backup, args.production_image, args.release_sha)
    expected_sha = env.get('GIT_SHA')
    password = secrets.token_hex(24)
    env.update(DATABASE_URL=f'postgresql://dkp:{password}@{database}:5432/dkp', REDIS_URL='',
               AUCTION_CLOSE_INTERVAL_MS='0', AUTH_TEST_MODE='false', PORT='3001', TRUST_PROXY='1')
    try:
        run('docker', 'network', 'create', '--internal', network)
        run('docker', 'run', '-d', '--name', database, '--network', network,
            '-e', 'POSTGRES_USER=dkp', '-e', 'POSTGRES_DB=dkp', '-e', f'POSTGRES_PASSWORD={password}', 'postgres:16-alpine')
        deadline = time.monotonic() + 60
        # Во время initdb временный сервер отвечает по сокету, но ещё не по TCP.
        while subprocess.run(['docker', 'exec', database, 'pg_isready', '-h', '127.0.0.1', '-U', 'dkp', '-d', 'dkp'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError('Restore database did not become ready')
            time.sleep(1)
        with (backup / 'database.dump').open('rb') as dump:
            run('docker', 'exec', '-i', database, 'pg_restore', '-U', 'dkp', '-d', 'dkp',
                '--no-owner', '--exit-on-error', stdin=dump)
        with tempfile.TemporaryDirectory(prefix=prefix) as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            env_file = root / 'api.env'
            env_file.write_text(''.join(f'{key}={value}\n' for key, value in env.items()))
            os.chmod(env_file, 0o600)
            uploads = root / 'screenshots'
            uploads.mkdir()
            with tarfile.open(backup / 'screenshots.tar.gz') as archive:
                archive.extractall(uploads, filter='data')
            # Existing data stays on its matched schema: no entrypoint migration or seed.
            run('docker', 'run', '-d', '--name', api, '--network', network, '--env-file', str(env_file),
                '--mount', f'type=bind,source={uploads},target=/app/uploads/screenshots,readonly', '--entrypoint', 'node', image, 'dist/main.js')
            deadline = time.monotonic() + 90
            check = "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(h=>{if(h.status!=='ok'||h.db!=='up'||!h.commit||!process.env.GIT_SHA.startsWith(h.commit))process.exit(1)}).catch(()=>process.exit(1))"
            while subprocess.run(['docker', 'exec', api, 'node', '-e', check], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                if time.monotonic() > deadline:
                    raise RuntimeError('Restored API health/version failed')
                time.sleep(1)
            login = """(async()=>{
              const r=await fetch('http://127.0.0.1:3001/auth/admin/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'https'},body:JSON.stringify({login:process.env.ADMIN_LOGIN,password:process.env.ADMIN_PASSWORD})});
              const body=await r.json(), cookie=r.headers.get('set-cookie');
              if(!r.ok||!body.ok||!cookie)throw Error('login');
              const {PrismaClient}=require('@prisma/client'), db=new PrismaClient();
              const files=await db.screenshot.findMany();
              const fs=require('node:fs');
              for(const file of files){
                const response=await fetch('http://127.0.0.1:3001/screenshots/'+file.id,{headers:{cookie:cookie.split(';')[0],'x-forwarded-proto':'https'}});
                if(!response.ok)throw Error('file download');
                const actual=Buffer.from(await response.arrayBuffer()), expected=fs.readFileSync('/app/uploads/screenshots/'+file.id);
                if(!actual.equals(expected))throw Error('file mismatch');
              }
              await db.$disconnect();
            })().catch(()=>process.exit(1))"""
            run('docker', 'exec', api, 'node', '-e', login)
            counts = run('docker', 'exec', database, 'psql', '-U', 'dkp', '-d', 'dkp', '-Atc', 'SELECT (SELECT count(*) FROM "Member"), (SELECT count(*) FROM "DkpEntry"), (SELECT count(*) FROM "Screenshot")').decode().strip()
            screenshots = len([p for p in uploads.rglob('*') if p.is_file()])
            print(json.dumps(dict(backup=backup.name, commit=expected_sha, counts=counts,
                                 restoredFiles=screenshots, login=True, isolated=True,
                                 snapshotAgeAtStartSeconds=age_seconds,
                                 rtoSeconds=round(time.monotonic() - started, 2))))
    finally:
        subprocess.run(['docker', 'rm', '-fv', api, database], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
