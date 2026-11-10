# Mission Control watchdog
# ---------------------------------------------------------------------------
# Starts Mission Control at login and keeps it running: a Scheduled Task runs
# this script at login and every 5 minutes (2026-08-08: the master's server
# stopped silently and the fleet had no master for two days). If nothing is
# listening on 127.0.0.1:3000 it launches server.cmd, hidden. No .vbs files:
# Smart App Control blocks them, and Windows is retiring VBScript.
#
#   .\watchdog.ps1              one check (what the task runs)
#   .\watchdog.ps1 -Install     register / repair the 5-minute Scheduled Task
#   .\watchdog.ps1 -Uninstall   remove the task
#   .\watchdog.ps1 -Status      show the task + last result + log tail
#
# Guards, so it never fights you:
#   * data\watchdog.pause  -> skip while the file exists (auto-expires after 2h,
#     so a forgotten pause cannot disable the watchdog forever).
#     PowerShell:  New-Item data\watchdog.pause     Remove-Item data\watchdog.pause
#   * a running `next build` / `next dev` / `npm run dev` -> skip (you are
#     mid dev-cycle; the port is meant to be free right now).
#   * it never kills anything. A listening-but-unresponsive server is only
#     logged as a warning - in-flight runs die with the process, and a hung
#     server is ambiguous. That is a human call.
#
# Log: data\watchdog.log (only actions + warnings, self-truncating).
# Everything is keyed off this script's own folder, so the repo can live
# anywhere on any machine - nothing here names a user profile.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$Repo     = $PSScriptRoot
$Port     = 3000
$TaskName = 'Mission Control Watchdog'
$DataDir  = Join-Path $Repo 'data'
$LogFile  = Join-Path $DataDir 'watchdog.log'
$PauseFile = Join-Path $DataDir 'watchdog.pause'
$RestartFile = Join-Path $DataDir 'watchdog.restart'   # written by the app to ask for a restart
$ServerCmd = Join-Path $Repo 'server.cmd'

function Write-Log([string]$msg) {
  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $env:COMPUTERNAME, $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  # keep the log small: past 512 KB, keep the newest 300 lines
  $item = Get-Item $LogFile -ErrorAction SilentlyContinue
  if ($item -and $item.Length -gt 524288) {
    $tail = Get-Content $LogFile -Tail 300
    Set-Content -Path $LogFile -Value $tail -Encoding UTF8
  }
}

function Test-PortListening {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

function Test-Http {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/system" -UseBasicParsing -TimeoutSec 15
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Test-DevCycleRunning {
  # A build or dev server in progress means the port is SUPPOSED to be free.
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $cl = $p.CommandLine
    if (-not $cl) { continue }
    if ($cl -match 'next(\.js)?["'' ]+(build|dev)\b' -or $cl -match 'npm(\.cmd)?["'' ]+run[ "'']+(build|dev)\b') { return $true }
  }
  return $false
}

# --------------------------------------------------------------------------
# Task management
# --------------------------------------------------------------------------
function Install-Watchdog {
  if (-not (Test-Path $ServerCmd)) { throw "server.cmd not found next to this script ($Repo)" }

  # `conhost --headless` keeps the check from flashing a console window. It
  # replaced wscript + watchdog.vbs (2026-11-08): Smart App Control / App
  # Control policies block .vbs files outright, and Windows is retiring VBScript.
  $psArgs  = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $Repo 'watchdog.ps1')
  $action  = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless powershell.exe ' + $psArgs) -WorkingDirectory $Repo
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  # At login (this is also what starts the server at login - no Startup-folder
  # launcher needed) and every 5 minutes after that.
  $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $me
  $atLogon.Delay = 'PT20S'
  $every5  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
               -RepetitionInterval (New-TimeSpan -Minutes 5) `
               -RepetitionDuration (New-TimeSpan -Days 3650)
  $trigger = @($atLogon, $every5)
  # Laptops: the defaults stop tasks on battery - that is exactly when a
  # backup node is most likely to be the only master, so override them.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -StartWhenAvailable -MultipleInstances IgnoreNew `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -Hidden
  # Interactive = runs in the logged-in session the server itself lives in,
  # no stored password needed.
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force `
    -Description "At login and every 5 min: if nothing listens on 127.0.0.1:$Port, start Mission Control's server.cmd (hidden). Script: $Repo\watchdog.ps1" | Out-Null

  # The task now starts the server at login, so an old Startup-folder launcher
  # would only race it (and is blocked outright where .vbs files are).
  $oldVbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'Mission Control Server.vbs'
  if (Test-Path $oldVbs) { Remove-Item $oldVbs -Force -ErrorAction SilentlyContinue; Write-Host "Removed the old Startup launcher ($oldVbs) - the task starts the server at login now." }

  Write-Log "installed task '$TaskName' as $me (at login + every 5 min, repo $Repo)"
  Write-Host "Installed '$TaskName' for $me - at login and every 5 minutes, repo: $Repo"
  Show-Status
}

function Uninstall-Watchdog {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Log "uninstalled task '$TaskName'"
    Write-Host "Removed '$TaskName'."
  } else {
    Write-Host "'$TaskName' is not installed."
  }
}

function Show-Status {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Task: NOT INSTALLED  (run .\watchdog.ps1 -Install)"; }
  else {
    $i = $t | Get-ScheduledTaskInfo
    Write-Host ("Task:      {0}  (state {1})" -f $TaskName, $t.State)
    Write-Host ("Last run:  {0}  result 0x{1:X}" -f $i.LastRunTime, $i.LastTaskResult)
    Write-Host ("Next run:  {0}" -f $i.NextRunTime)
  }
  Write-Host ("Port {0}:  {1}" -f $Port, $(if (Test-PortListening) { 'LISTENING' } else { 'not listening' }))
  if (Test-Path $PauseFile) { Write-Host "PAUSED:    $PauseFile exists (since $((Get-Item $PauseFile).LastWriteTime))" }
  if (Test-Path $LogFile) {
    Write-Host "--- $LogFile (tail) ---"
    Get-Content $LogFile -Tail 10
  }
}

# --------------------------------------------------------------------------
# The check itself
# --------------------------------------------------------------------------
function Invoke-Check {
  if (Test-Path $PauseFile) {
    $age = (Get-Date) - (Get-Item $PauseFile).LastWriteTime
    if ($age.TotalHours -lt 2) { return }           # deliberately paused
    Remove-Item $PauseFile -Force -ErrorAction SilentlyContinue
    Write-Log "pause file was $([int]$age.TotalHours)h old - expired, resuming checks"
  }

  # Restart requested by the app (Settings -> This network -> Restart now, e.g. after changing
  # the vault): stop the running server so the relaunch below picks up .env.local changes.
  # The app can't restart itself reliably - a helper it spawns dies with it.
  if (Test-Path $RestartFile) {
    $age = (Get-Date) - (Get-Item $RestartFile).LastWriteTime
    Remove-Item $RestartFile -Force -ErrorAction SilentlyContinue
    if ($age.TotalMinutes -lt 10) {
      $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
      foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
      Write-Log "restart requested by the app - stopped the server (pid $($pids -join ', '))"
      $wait = (Get-Date).AddSeconds(15)
      while ((Test-PortListening) -and (Get-Date) -lt $wait) { Start-Sleep -Milliseconds 500 }
    }
  }

  if (Test-PortListening) {
    if (-not (Test-Http)) {
      Write-Log "WARN port $Port is listening but /api/system did not answer within 15s (not touching it)"
    }
    return
  }

  if (Test-DevCycleRunning) {
    Write-Log "port $Port free but a next build/dev process is running - skipping (dev cycle in progress)"
    return
  }

  if (-not (Test-Path $ServerCmd)) {
    Write-Log "ERROR port $Port free and $ServerCmd is missing - cannot relaunch"
    return
  }

  Write-Log "port $Port not listening - relaunching server.cmd"
  Start-Process -FilePath $ServerCmd -WorkingDirectory $Repo -WindowStyle Hidden

  # confirm, rather than launch blind (a silent-start bug once hid behind that)
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-PortListening) {
      $http = Test-Http
      Write-Log ("recovered: port {0} listening, /api/system {1}" -f $Port, $(if ($http) { 'OK' } else { 'not answering yet' }))
      return
    }
  }
  Write-Log "ERROR relaunched server.cmd but port $Port still not listening after 90s - check .env.local / npm start by hand"
}

if     ($Install)   { Install-Watchdog }
elseif ($Uninstall) { Uninstall-Watchdog }
elseif ($Status)    { Show-Status }
else                { Invoke-Check }
