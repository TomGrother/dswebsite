#requires -Version 5
<#
  Registers the "DS Order Hub Sync" scheduled task on an always-on Windows box:
  runs hourly from 07:00 to 17:00 every day (07,08,...,17 = 11 runs/day).

  Run this ONCE, on the box that will host the sync, in an ELEVATED PowerShell.

  By default the task runs as the built-in SYSTEM account: no password, always
  available, ideal for an unattended box. The sync logs in to SQL Server with
  its own SQL login (from .env), so the task's Windows identity only needs
  network + local-disk access, which SYSTEM has.

  Usage:
    .\install-task.ps1                                   # run as SYSTEM (recommended)
    .\install-task.ps1 -SyncDir 'C:\Apps\ds-order-sync'  # different folder
    .\install-task.ps1 -TaskUser 'DS\svc_ordersync'      # a specific account (prompts for password)
#>
param(
  [string]$SyncDir  = $PSScriptRoot,
  [string]$TaskUser = 'SYSTEM',
  [string]$TaskName = 'DS Order Hub Sync'
)

$wrapper = Join-Path $SyncDir 'run-sync.ps1'
if (-not (Test-Path -LiteralPath $wrapper)) { throw "run-sync.ps1 not found in $SyncDir" }

# Daily 07:00 trigger, then repeat every hour for 10 hours -> last run 17:00.
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00am
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At 7:00am -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 10)).Repetition

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`"" -WorkingDirectory $SyncDir

# All settings on ONE line — a comment after a backtick continuation breaks it.
# IgnoreNew: never stack runs. StartWhenAvailable: catch up a missed run.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

$desc = 'Pushes recent doors from the internal SQL Server to the Order Hub ingest endpoint. Hourly 07:00-17:00.'

if ($TaskUser -in @('SYSTEM', 'NT AUTHORITY\SYSTEM', 'LocalSystem')) {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Force -Trigger $trigger -Action $action -Settings $settings -Principal $principal -Description $desc
}
else {
  $cred = Get-Credential -UserName $TaskUser -Message 'Password for the account that runs the sync'
  Register-ScheduledTask -TaskName $TaskName -Force -Trigger $trigger -Action $action -Settings $settings -RunLevel Limited -User $cred.UserName -Password $cred.GetNetworkCredential().Password -Description $desc
}

Write-Host "`nRegistered '$TaskName' (runs as $TaskUser)." -ForegroundColor Green
Write-Host 'Next scheduled run:'
(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).NextRunTime
