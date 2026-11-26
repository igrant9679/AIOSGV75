# Mission Control self-update (Fleet -> Versions -> Update)
# ---------------------------------------------------------------------------
# Started DETACHED by the running server (lib/selfUpdate.ts) once nothing it
# started is running, because this script is what restarts that server.
#
#   1. pull this install's own branch from its own git remote (the same
#      self-healing pull update.cmd uses: install.ps1 -RepairOnly)
#   2. npm install, only when package.json / package-lock.json changed
#   3. npm run build  (the build stamps the commit, scripts/stamp-build.mjs)
#      - a failed build goes back to the commit it came from and rebuilds that,
#        so the machine keeps working on the version it had
#   4. restart: stop the server on port 3000 and let the watchdog task start it
#
# Reports to data\update-status.json (read by the server, before and after the
# restart); full output in data\update.log. Plain ASCII on purpose: Windows
# PowerShell 5.1 misreads UTF-8 without a BOM.
# ---------------------------------------------------------------------------
param(
  [string]$JobId = "",
  [string]$By = ""
)

$ErrorActionPreference = 'Continue'
# npm and git print UTF-8; read it as such, or the log shows mojibake for every check mark
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$Data = Join-Path $Repo 'data'
if (-not (Test-Path $Data)) { New-Item -ItemType Directory -Path $Data | Out-Null }
$StatusFile = Join-Path $Data 'update-status.json'
$LogFile = Join-Path $Data 'update.log'
$PauseFile = Join-Path $Data 'watchdog.pause'
$Port = 3000
$TaskName = 'Mission Control Watchdog'

function NowMs { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

$status = [ordered]@{
  jobId = $JobId; by = $By; state = 'running'; step = 'starting'; steps = @()
  oldHead = ''; newHead = ''; note = ''; upToDate = $false; rolledBack = $false
  startedAt = (NowMs); at = (NowMs)
}

function Save {
  $status.at = NowMs
  $json = $status | ConvertTo-Json -Depth 4
  $tmp = "$StatusFile.$PID.tmp"
  # .NET writes UTF-8 without a BOM (Set-Content -Encoding UTF8 would add one)
  [IO.File]::WriteAllText($tmp, $json)
  Move-Item -Force $tmp $StatusFile
}

function Log([string]$t) { Add-Content -Path $LogFile -Value $t -Encoding UTF8 }

function Step([string]$name, [string]$text) {
  $status.step = $name
  $status.steps = @($status.steps) + ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $text)
  Save
  Log ("=== {0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text)
}

# The reason, in a few lines: error lines from the end of the log, without colour codes, stack
# frames or the code excerpts a build prints.
function Tail([int]$n = 3) {
  try {
    $esc = [char]27
    $lines = @(Get-Content $LogFile -Tail 300 -Encoding UTF8 | ForEach-Object { ($_ -replace "$esc\[[0-9;]*m", '').Trim() } | Where-Object { $_ -and $_ -notmatch '^(===|> |at |\||>?\s*\d+ \||-)' })
    $err = @($lines | Where-Object { $_ -match 'error|failed|fatal|not found|denied|cannot|can.t' } | Select-Object -Last $n)
    if (-not $err.Count) { $err = @($lines | Select-Object -Last $n) }
    $t = $err -join ' | '
    if ($t.Length -gt 400) { $t = $t.Substring(0, 400) + '...' }
    return $t
  } catch { return '' }
}

function Finish([string]$state, [string]$note) {
  $status.state = $state
  $status.note = $note
  Step 'finished' $note
  Remove-Item $PauseFile -Force -ErrorAction SilentlyContinue
  exit 0
}

# Run a native command, its output to the log; returns the exit code.
function Run([string]$exe, [string[]]$argv) {
  Log ("> {0} {1}" -f $exe, ($argv -join ' '))
  # through the pipeline, not *>>: in PowerShell 5.1 that redirect writes UTF-16 into a UTF-8 log
  & $exe @argv 2>&1 | ForEach-Object { [string]$_ } | Add-Content -Path $LogFile -Encoding UTF8
  return $LASTEXITCODE
}

# Named GitOut, and git.exe spelled out everywhere: PowerShell looks up functions before
# programs and ignores case, so inside a function called "Git", "git" was the function itself.
function GitOut([string[]]$argv) {
  $out = & git.exe @argv 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return ([string]($out | Select-Object -First 1)).Trim()
}

function BuiltCommit {
  try { return ((Get-Content (Join-Path $Repo '.next\mc-build.json') -Raw | ConvertFrom-Json).commit) } catch { return '' }
}

# One retry before rolling back: a fluke is no reason to go back a version. (Builds used to fetch
# Google fonts and failed about one time in three; the fonts are in app/fonts now.)
function Build {
  $c = Run 'npm.cmd' @('run', 'build')
  if ($c -ne 0) { Log "first build attempt ended with exit code $c; trying once more"; Start-Sleep -Seconds 30; $c = Run 'npm.cmd' @('run', 'build') }
  return $c
}

function DepsChanged([string]$a, [string]$b) {
  if (-not (Test-Path (Join-Path $Repo 'node_modules'))) { return $true }
  if ($a -eq $b) { return $false }
  $files = & git.exe diff --name-only $a $b -- package.json package-lock.json 2>$null
  return [bool]$files
}

function Test-Up {
  try { return ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/system" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) } catch { return $false }
}

function Restart-Server {
  $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Log "stopped the server (pid $($pids -join ', '))"
  $wait = (Get-Date).AddSeconds(20)
  while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $wait) { Start-Sleep -Milliseconds 500 }
  Remove-Item $PauseFile -Force -ErrorAction SilentlyContinue
  # The watchdog task starts it the usual way (hidden, logging to data\server.log).
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Log "asked '$TaskName' to start it" }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 2 }
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    # no watchdog task, or it was busy: start it directly (server.cmd refuses to double-start)
    Start-Process -FilePath (Join-Path $Repo 'server.cmd') -ArgumentList '--log' -WorkingDirectory $Repo -WindowStyle Hidden
    Log "started server.cmd directly"
  }
  $deadline = (Get-Date).AddSeconds(150)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-Up) { return $true }
  }
  return $false
}

Log ''
Log ("===== {0} update asked by {1} (job {2}) =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $By, $JobId)

# ---- 1. the code ----
$old = GitOut @('rev-parse', 'HEAD')
$status.oldHead = $old
Step 'pull' 'Getting the new code'
$code = Run 'powershell.exe' @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Repo 'install.ps1'), '-RepairOnly', '-Yes', '-RepoDir', $Repo)
$new = GitOut @('rev-parse', 'HEAD')
$status.newHead = $new
if ($code -ne 0) {
  if ($new -and $new -ne $old) { Log "pull reported a problem but HEAD moved to $new - carrying on" }
  else { Finish 'failed' ("Couldn't get the new code, so nothing was changed. {0}" -f (Tail 3)) }
}

$built = BuiltCommit
if ($new -eq $old -and $built -eq $new) {
  $status.upToDate = $true
  Finish 'done' ("Already up to date ({0})." -f $new.Substring(0, 7))
}

# ---- 2. packages, 3. build ----
New-Item -ItemType File -Path $PauseFile -Force | Out-Null   # the watchdog leaves the port alone meanwhile
$buildFailed = $false
if (DepsChanged $old $new) {
  Step 'install' 'Installing packages'
  if ((Run 'npm.cmd' @('install', '--no-audit', '--no-fund')) -ne 0) { Log "npm install failed" ; $buildFailed = $true }
}
if (-not $buildFailed) {
  Step 'build' ("Building {0}" -f $new.Substring(0, 7))
  $buildFailed = ((Build) -ne 0)
}

if ($buildFailed) {
  $why = Tail 3
  if ($new -ne $old -and $old) {
    Step 'rollback' ("Build failed - going back to {0}" -f $old.Substring(0, 7))
    $r = Run 'git.exe' @('reset', '--keep', $old)
    if ($r -eq 0) {
      if (DepsChanged $new $old) { Run 'npm.cmd' @('install', '--no-audit', '--no-fund') | Out-Null }
      if ((Build) -eq 0) {
        $status.rolledBack = $true
        $status.newHead = $old
        Step 'restart' 'Restarting on the previous version'
        $null = Restart-Server
        Finish 'failed' ("The new version ({0}) didn't build, so this machine went back to {1} and is running that. {2}" -f $new.Substring(0, 7), $old.Substring(0, 7), $why)
      }
    }
    Finish 'failed' ("The new version didn't build, and rebuilding the previous one failed too. Mission Control was NOT restarted; run update.cmd on this machine. {0}" -f $why)
  }
  Finish 'failed' ("The build failed, so Mission Control was not restarted. {0}" -f $why)
}

# ---- 4. restart ----
# "done" is written BEFORE the restart: the new server settles the job when it sees it is
# serving newHead. If the restart never comes, the old server reports that after 12 minutes.
$status.state = 'done'
$status.note = ("Updated {0} -> {1}" -f $old.Substring(0, 7), $new.Substring(0, 7))
Step 'restart' 'Restarting'
if (Restart-Server) { $status.steps = @($status.steps) + ("{0} Back up on {1}" -f (Get-Date -Format 'HH:mm:ss'), $new.Substring(0, 7)) }
else { $status.steps = @($status.steps) + ("{0} Not answering yet - the watchdog will start it within 5 minutes" -f (Get-Date -Format 'HH:mm:ss')) }
Save
Remove-Item $PauseFile -Force -ErrorAction SilentlyContinue
Log "===== finished ====="
exit 0
