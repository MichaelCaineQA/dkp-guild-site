# Process trees of the dev-screenshot stand (scripts/dev-screenshot.sh). Read-only:
# reports who launched the listeners of the stand ports; the shell script does the killing.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dev-screenshot-procs.ps1
#       [-Ports 3005,3090] [-Checkout C:\path\to\checkout] [-Roots api:1234;web:5678] [-Leftovers]
#
# Output lines, tab separated:
#   port      <port> <rootPid> <owner> <listenerPid> <command line of the root>
#   recorded  <label> <rootPid> <owner> <command line>        (one per -Roots entry)
#   leftover  <pid> <created> <command line>                  (with -Leftovers)
#
# owner: own     - some process of the chain/tree refers to -Checkout;
#        foreign - it refers to another checkout (...\apps\api or ...\apps\web);
#        gone    - the recorded process no longer exists;
#        unknown - neither (cannot tell), so it must not be killed by this report alone.
#
# The parent chain is walked from the listener upwards. Above the launcher the chain
# is already broken: an MSYS exec leaves the new process with the id of a finished
# one as its parent. Shells are left out of the walk on purpose, so it never climbs
# into somebody's terminal.
#
# Windows only. ASCII on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Ports = '',
  [string]$Checkout = '',
  [string]$Roots = '',
  [switch]$Leftovers
)

$ErrorActionPreference = 'Stop'

$processes = @(Get-CimInstance Win32_Process)
$byId = @{}
$kids = @{}
foreach ($p in $processes) {
  $byId[[int]$p.ProcessId] = $p
  $pp = [int]$p.ParentProcessId
  if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }
  [void]$kids[$pp].Add($p)
}

# Package runners and their cmd.exe wrappers.
$runnerNames = @('node.exe', 'cmd.exe', 'pnpm.exe', 'pnpm-native.exe', 'npm.exe', 'npx.exe', 'corepack.exe')
$runnerPattern = 'nest(\.js)?"?\s+start|\\@nestjs\\cli\\|dist[\\/]main|\bpnpm\b|pnpm-native|corepack|npx-cli\.js|\bnpx\b|[\\/]next[\\/]dist[\\/]|start-server\.js'
$anotherCheckout = '[\\/]apps[\\/](api|web)[\\/]'
$watcherPattern = 'nest(\.js)"?\s+start\s+--watch|[\\/]next[\\/]dist[\\/]bin[\\/]next"?\s+dev'

function Get-Owner($items) {
  if ($Checkout) {
    foreach ($p in $items) {
      if ($p.CommandLine -and $p.CommandLine.IndexOf($Checkout, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return 'own' }
    }
  }
  foreach ($p in $items) {
    if ($p.CommandLine -and $p.CommandLine -match $anotherCheckout) { return 'foreign' }
  }
  return 'unknown'
}

function Get-Chain([int]$startId) {
  $chain = New-Object System.Collections.ArrayList
  $id = $startId
  for ($i = 0; $i -lt 24 -and $byId.ContainsKey($id); $i++) {
    [void]$chain.Add($byId[$id])
    $id = [int]$byId[$id].ParentProcessId
  }
  return ,$chain
}

function Get-Root($chain) {
  # The topmost process that is a runner by name and by command line.
  $root = $chain[0]
  for ($i = 1; $i -lt $chain.Count; $i++) {
    $p = $chain[$i]
    if ($runnerNames -notcontains $p.Name.ToLowerInvariant() -or -not $p.CommandLine -or $p.CommandLine -notmatch $runnerPattern) { break }
    $root = $p
  }
  return $root
}

function Get-Tree([int]$rootId) {
  # The root and all of its live descendants.
  $tree = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($rootId)
  $seen = @{}
  while ($queue.Count -gt 0) {
    $id = [int]$queue.Dequeue()
    if ($seen.ContainsKey($id) -or -not $byId.ContainsKey($id)) { continue }
    $seen[$id] = $true
    [void]$tree.Add($byId[$id])
    if ($kids.ContainsKey($id)) { foreach ($c in $kids[$id]) { $queue.Enqueue([int]$c.ProcessId) } }
  }
  return ,$tree
}

function Format-Command($p) {
  if (-not $p.CommandLine) { return $p.Name }
  $s = $p.CommandLine -replace '[\t\r\n]+', ' '
  if ($s.Length -gt 160) { $s = $s.Substring(0, 160) }
  return $s
}

if ($Ports -and (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
  foreach ($port in ($Ports -split ',' | ForEach-Object { [int]$_.Trim() })) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($listenerId in $listeners) {
      if (-not $byId.ContainsKey([int]$listenerId)) { continue }
      $chain = Get-Chain ([int]$listenerId)
      $root = Get-Root $chain
      Write-Output ((@('port', $port, $root.ProcessId, (Get-Owner $chain), $listenerId, (Format-Command $root))) -join "`t")
    }
  }
}

if ($Roots) {
  foreach ($entry in ($Roots -split ';')) {
    $parts = $entry.Split(':', 2)
    if ($parts.Count -ne 2 -or $parts[1] -notmatch '^\d+$') { continue }
    $id = [int]$parts[1]
    if (-not $byId.ContainsKey($id)) {
      Write-Output ((@('recorded', $parts[0], $id, 'gone', '')) -join "`t")
      continue
    }
    $root = $byId[$id]
    Write-Output ((@('recorded', $parts[0], $id, (Get-Owner (Get-Tree $id)), (Format-Command $root))) -join "`t")
  }
}

if ($Leftovers) {
  foreach ($p in $processes) {
    if ($p.Name -ne 'node.exe' -or -not $p.CommandLine -or $p.CommandLine -notmatch $watcherPattern) { continue }
    if ($Checkout -and $p.CommandLine.IndexOf($Checkout, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    Write-Output ((@('leftover', $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss'), (Format-Command $p))) -join "`t")
  }
}
