#requires -Version 5
<#
  Wrapper for the internal Order Hub sync. Task Scheduler runs THIS (not node
  directly) so that every run's output is captured to a dated log file and old
  logs are pruned. The sync's own exit code is propagated, so a failed sync
  shows up as a failed task in Task Scheduler history.

  Node must be on PATH for the account the task runs as. If it isn't, set an
  environment variable NODE_EXE to the full path of node.exe (e.g. via the task
  action, or system env vars) and this wrapper will use it.
#>
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('sync_{0:yyyy-MM-dd}.log' -f (Get-Date))

$node = if ($env:NODE_EXE) { $env:NODE_EXE } else { 'node' }

# Run the sync, appending all streams to the day's log. Native-command stderr
# must not abort the wrapper before we read the exit code, so relax the pref
# just around the call.
"--- run $(Get-Date -Format o) ---" | Add-Content -LiteralPath $log
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $node 'sync.js' *>> $log
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
"--- exit $code ---" | Add-Content -LiteralPath $log

# Keep 30 days of logs.
Get-ChildItem -LiteralPath $logDir -Filter 'sync_*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
