param([string]$Destination = (Join-Path $env:USERPROFILE 'Backups/dkp-staging'))
$ErrorActionPreference = 'Stop'
$installDirectory = Join-Path $env:USERPROFILE '.dkp-backup'
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$script = Join-Path $installDirectory 'pull-backups.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pull-backups.ps1') -Destination $script -Force
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script + '" -Destination "' + $Destination + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At '10:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'DKP staging backup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Download and verify daily staging backup over SSH; retain 30 local copies.' -Force | Out-Null
Write-Output "Daily backup installed at 10:00: $Destination"
