param(
    [string]$Destination,
    [int]$Keep = 30,
    [ValidateSet('staging', 'production')]
    [string]$Environment = 'staging'
)
$ErrorActionPreference = 'Stop'
if ($Keep -lt 1) { throw 'Keep must be positive' }
if (!$Destination) { $Destination = Join-Path $env:USERPROFILE "Backups/dkp-$Environment" }
$production = $Environment -eq 'production'
$source = if ($production) { '/opt/dkp-production/backups' } else { '/opt/dkp-guild-site/backups' }
$serverName = if ($production) { 'suneclipse.ru' } else { 'stage.suneclipse.ru' }
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20')
$backupRoot = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
# Production содержит пользовательские данные. Ограничиваем доступ до загрузки.
if ($production) {
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl = Get-Acl -LiteralPath $backupRoot
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $expected = @($account.Value, $system.Value)
    $matching = @($rules | Where-Object {
        $_.IdentityReference.Value -in $expected -and
        $_.FileSystemRights -eq 'FullControl' -and
        $_.AccessControlType -eq 'Allow' -and
        $_.InheritanceFlags -eq 'ContainerInherit,ObjectInherit' -and
        $_.PropagationFlags -eq 'None'
    })
    if (!$acl.AreAccessRulesProtected -or $rules.Count -ne 2 -or
        @($matching.IdentityReference.Value | Select-Object -Unique).Count -ne 2) {
        $acl.SetAccessRuleProtection($true, $false)
        $acl.PurgeAccessRules($account)
        $acl.PurgeAccessRules($system)
        foreach ($rule in $rules) { $acl.PurgeAccessRules($rule.IdentityReference) }
        foreach ($identity in @($account, $system)) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $backupRoot -AclObject $acl
    }
}

function Get-BackupDate([string]$Value) {
    [DateTime]::ParseExact($Value, "yyyyMMdd'T'HHmmss'Z'",
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]'AssumeUniversal,AdjustToUniversal')
}

try {
    # Скачивание через существующий SSH alias: ключ и секреты не копируются в скрипт.
    $stamps = & ssh @sshOptions dkp-stage "flock -s -w 40 /run/lock/dkp-deploy.lock find '$source' -mindepth 1 -maxdepth 1 -type d -printf '%f\n'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not list server backups (SSH or deploy lock)' }
    $stamp = $stamps | Where-Object { $_ -match '^\d{8}T\d{6}Z$' } | Sort-Object | Select-Object -Last 1
    if (!$stamp) { throw 'No valid server backup' }
    if ($production -and (Get-BackupDate $stamp) -lt [DateTime]::UtcNow.AddHours(-26)) {
        throw "Latest production backup is older than 26 hours: $stamp"
    }
    $target = Join-Path $backupRoot $stamp
    $verifiedPath = Join-Path $target 'verified.json'
    if (Test-Path -LiteralPath $verifiedPath) {
        if ($production) {
            $existing = Get-Content -LiteralPath $verifiedPath -Raw | ConvertFrom-Json
            if ($existing.environment -ne 'production' -or $existing.backup -ne $stamp) {
                throw "Backup manifest does not match production copy: $stamp"
            }
            foreach ($name in @('database.dump', 'screenshots.tar.gz')) {
                $hash = (Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash
                if ($hash -ne $existing.sha256.$name) { throw "Local checksum mismatch: $name" }
            }
        }
    } else {
        $partial = Join-Path $backupRoot ($stamp + '.partial-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $partial | Out-Null
        & scp -q @sshOptions "dkp-stage:$source/$stamp/database.dump" "dkp-stage:$source/$stamp/screenshots.tar.gz" $partial
        if ($LASTEXITCODE -ne 0) { throw 'Backup download failed; partial copy retained' }
        $hashes = @{}
        foreach ($name in @('database.dump', 'screenshots.tar.gz')) {
            $local = Join-Path $partial $name
            if ((Get-Item -LiteralPath $local).Length -eq 0) { throw "Empty backup: $name" }
            $remoteLine = & ssh @sshOptions dkp-stage "sha256sum '$source/$stamp/$name'"
            if ($LASTEXITCODE -ne 0 -or $remoteLine -notmatch '^([0-9a-f]{64}) ') { throw 'Remote checksum unavailable' }
            $remote = $Matches[1]
            $hash = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $remote) { throw "Checksum mismatch: $name" }
            $hashes[$name] = $hash
        }
        $health = & ssh @sshOptions dkp-stage "curl -fsS 'https://$serverName/api/health'"
        if ($LASTEXITCODE -ne 0) { throw 'Version check failed' }
        $version = $health | ConvertFrom-Json
        if ($production -and $version.commit -notmatch '^[0-9a-f]{12,40}$') { throw 'Production commit unavailable' }
        @{ backup = $stamp; environment = $Environment; downloadedAt = [DateTime]::UtcNow.ToString('o'); observedServerCommit = $version.commit; sha256 = $hashes } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $partial 'verified.json') -Encoding utf8
        if (Test-Path -LiteralPath $target) { throw 'Unverified target exists; inspect it before retrying' }
        Move-Item -LiteralPath $partial -Destination $target
    }
    # Ротация затрагивает только проверенные timestamp-каталоги внутри указанного корня.
    $expired = Get-ChildItem -LiteralPath $backupRoot -Directory | Where-Object { $_.Name -match '^\d{8}T\d{6}Z$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'verified.json')) } | Sort-Object Name -Descending | Select-Object -Skip $Keep
    if ($production) {
        $cutoff = [DateTime]::UtcNow.AddDays(-30)
        $expired = Get-ChildItem -LiteralPath $backupRoot -Directory |
            Where-Object {
                $_.Name -match '^\d{8}T\d{6}Z$' -and
                (Test-Path -LiteralPath (Join-Path $_.FullName 'verified.json')) -and
                (Get-BackupDate $_.Name) -lt $cutoff -and
                (Get-Content -LiteralPath (Join-Path $_.FullName 'verified.json') -Raw | ConvertFrom-Json).environment -eq 'production'
            }
    }
    foreach ($entry in $expired) {
        $resolved = [IO.Path]::GetFullPath($entry.FullName)
        if ([IO.Path]::GetDirectoryName($resolved) -ne $backupRoot) { throw 'Unsafe retention path' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    Write-Output "Verified local backup: $target"
    if ($production) {
        "OK $([DateTime]::UtcNow.ToString('o')) $stamp" | Set-Content -LiteralPath (Join-Path $backupRoot 'last-run.txt')
    }
} catch {
    if ($production) {
        "ERROR $([DateTime]::UtcNow.ToString('o')) $($_.Exception.Message)" | Set-Content -LiteralPath (Join-Path $backupRoot 'last-run.txt')
    }
    throw
}
