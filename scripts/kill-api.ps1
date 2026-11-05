Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*dist/main.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ("killed " + $_.ProcessId) }
