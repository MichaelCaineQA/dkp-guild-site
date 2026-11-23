param(
    [string]$Destination,
    [ValidateSet('staging', 'production')]
    [string]$Environment = 'staging'
)
$ErrorActionPreference = 'Stop'
if (!$Destination) { $Destination = Join-Path $env:USERPROFILE "Backups/dkp-$Environment" }
$installDirectory = Join-Path $env:USERPROFILE ".dkp-backup/$Environment"
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$script = Join-Path $installDirectory 'pull-backups.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pull-backups.ps1') -Destination $script -Force
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script + '" -Environment ' + $Environment + ' -Destination "' + $Destination + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At '10:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "DKP $Environment backup" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Download and verify daily $Environment backup over SSH; retain 30 days." -Force | Out-Null
Write-Output "Daily backup installed at 10:00: $Destination"
