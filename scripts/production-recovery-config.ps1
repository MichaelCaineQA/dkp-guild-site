param(
    [ValidateSet('Save', 'Verify', 'Restore')]
    [string]$Action = 'Verify'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$root = Join-Path $env:USERPROFILE 'Backups/dkp-production'
if (!(Test-Path -LiteralPath $root) -or !(Get-Acl -LiteralPath $root).AreAccessRulesProtected) {
    throw 'Install the protected production backup directory first'
}
$encrypted = Join-Path $root 'recovery-config.dpapi'
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$bytes = $null
try {
    if ($Action -eq 'Save') {
        $encoded = & ssh -o BatchMode=yes -o ConnectTimeout=20 dkp-stage 'base64 -w0 /opt/dkp-production/.env.production'
        if ($LASTEXITCODE -ne 0 -or !$encoded) { throw 'Production configuration unavailable' }
        $bytes = [Convert]::FromBase64String($encoded)
        $encoded = $null
    } else {
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
            [IO.File]::ReadAllBytes($encrypted), $null, $scope)
    }
    $config = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($name in @('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL',
        'SESSION_SECRET', 'CHECKIN_ENC_KEY', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
        'ADMIN_LOGIN', 'ADMIN_PASSWORD', 'WEB_HOST', 'API_HOST')) {
        if ($config -notmatch "(?m)^${name}=\S") { throw "Required key unavailable: $name" }
    }
    $config = $null
    if ($Action -eq 'Save') {
        $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
        $pending = Join-Path $root ("recovery-config." + [guid]::NewGuid().ToString('N') + '.pending')
        try {
            [IO.File]::WriteAllBytes($pending, $protected)
            if ([IO.File]::Exists($encrypted)) {
                $previous = "$pending.previous"
                [IO.File]::Replace($pending, $encrypted, $previous)
                [IO.File]::Delete($previous)
            } else {
                [IO.File]::Move($pending, $encrypted)
            }
        } finally {
            if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
        }
    }
    if ($Action -eq 'Restore') {
        $restored = Join-Path $root '.env.production.recovery'
        $stream = [IO.File]::Open($restored, [IO.FileMode]::CreateNew)
        try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    Write-Output "Production recovery configuration: $Action OK"
} finally {
    if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
}
