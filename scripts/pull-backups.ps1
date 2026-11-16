param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'Backups/dkp-staging'),
    [int]$Keep = 30
)
$ErrorActionPreference = 'Stop'
if ($Keep -lt 1) { throw 'Keep must be positive' }
$backupRoot = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
# Скачивание через существующий SSH alias: ключ и секреты не копируются в скрипт.
$stamp = (& ssh -o BatchMode=yes -o ConnectTimeout=20 dkp-stage "find /opt/dkp-guild-site/backups -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -1").Trim()
if ($LASTEXITCODE -ne 0 -or $stamp -notmatch '^\d{8}T\d{6}Z$') { throw 'No valid server backup' }
$target = Join-Path $backupRoot $stamp
if (!(Test-Path -LiteralPath (Join-Path $target 'verified.json'))) {
    $partial = Join-Path $backupRoot ($stamp + '.partial-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $partial | Out-Null
    & scp -q -o BatchMode=yes -o ConnectTimeout=20 "dkp-stage:/opt/dkp-guild-site/backups/$stamp/database.dump" "dkp-stage:/opt/dkp-guild-site/backups/$stamp/screenshots.tar.gz" $partial
    if ($LASTEXITCODE -ne 0) { throw 'Backup download failed; partial copy retained' }
    $hashes = @{}
    foreach ($name in @('database.dump', 'screenshots.tar.gz')) {
        $local = Join-Path $partial $name
        if ((Get-Item -LiteralPath $local).Length -eq 0) { throw "Empty backup: $name" }
        $remote = (& ssh -o BatchMode=yes dkp-stage "sha256sum /opt/dkp-guild-site/backups/$stamp/$name").Split(' ')[0]
        if ($LASTEXITCODE -ne 0) { throw 'Remote checksum unavailable' }
        $hash = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $remote) { throw "Checksum mismatch: $name" }
        $hashes[$name] = $hash
    }
    $version = (& ssh -o BatchMode=yes dkp-stage 'curl -fsS https://stage.suneclipse.ru/api/health') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Version check failed' }
    @{ backup = $stamp; downloadedAt = [DateTime]::UtcNow.ToString('o'); observedServerCommit = $version.commit; sha256 = $hashes } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $partial 'verified.json') -Encoding utf8
    if (Test-Path -LiteralPath $target) { throw 'Unverified target exists; inspect it before retrying' }
    Move-Item -LiteralPath $partial -Destination $target
}
# Ротация затрагивает только проверенные timestamp-каталоги внутри указанного корня.
$expired = Get-ChildItem -LiteralPath $backupRoot -Directory | Where-Object { $_.Name -match '^\d{8}T\d{6}Z$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'verified.json')) } | Sort-Object Name -Descending | Select-Object -Skip $Keep
foreach ($entry in $expired) {
    $resolved = [IO.Path]::GetFullPath($entry.FullName)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $backupRoot) { throw 'Unsafe retention path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output "Verified local backup: $target"
