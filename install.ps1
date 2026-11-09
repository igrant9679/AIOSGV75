<#
  Mission Control - Windows installer, updater, modifier and uninstaller.
  MC-INSTALLER-VERSION: 2026.11.09.1   (bump on every change; setup.exe runs the newer of its bundled copy and GitHub's)

  Run it any time. On a machine without Mission Control it installs everything;
  on a machine that has it, it asks what you want:

    1  Update / repair   - latest code, fix git links, rebuild, re-check everything
    2  Modify            - change name/role, vault, add or remove Codex / Hermes /
                           OpenClaw / local models, sign-ins, auto-start on/off
    3  Reinstall         - fresh copy of the app; keeps data\ and .env.local
    4  Uninstall         - stop it, remove auto-start + watchdog, leave the machine
                           group, remove the app (optional backup of your settings)

  What a full install covers:
    Git, Node.js 22.15+, Ollama + local models, the app (clone + build),
    Claude Code + Codex CLIs, the Obsidian vault (found and pinned offline),
    .env.local, the machine group (name + role), Hermes and OpenClaw (optional,
    official installers, with links), Claude / Codex sign-in (browser),
    start-at-login + watchdog for Mission Control and Ollama, then it starts
    everything, runs the health check and opens the dashboard.

  Fresh machine (the repo is public), in PowerShell:
    irm https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1 -OutFile "$env:TEMP\mc-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\mc-install.ps1"
  Or run MissionControlSetup.exe (built by installer\build-installer.cmd), or
  double-click install.cmd inside an existing install.

  Flags (all optional):
    -Mode install|modify|reinstall|uninstall   skip the menu
    -DryRun          report what would happen, change nothing
    -Yes             accept defaults, ask nothing (sign-ins are skipped)
    -RepoDir <path>  install folder (default Documents\mission-control)
    -Vault <path>    vault folder (the one containing "Agentic OS")
    -Label <name>    display name in the machine group (default: computer name)
    -Role <primary|backup|workstation>   default: workstation
    -SkipModels / -SkipOllama            no local models / no Ollama
    -InstallCodex / -NoCodex             Codex CLI without asking / never
    -InstallHermes / -InstallOpenClaw    run those official installers without asking
    -NoCompanions    don't offer Hermes / OpenClaw
    -NoLogin         don't offer the Claude / Codex browser sign-ins
    -NoStart         don't start the server or open the browser at the end
    -RepairOnly      only fix/update the code (git link, hand-copied files) and stop

  Never handles passwords: sign-ins happen in the official CLIs' own browser
  flow. Install / update / modify / reinstall never delete data\ or .env.local
  (your settings and API keys); uninstall offers a backup first.
  This file is plain ASCII on purpose - Windows PowerShell 5.1 misreads UTF-8
  without a BOM.
#>
param(
  [ValidateSet("", "install", "update", "modify", "reinstall", "uninstall")][string]$Mode = "",
  [string]$RepoDir = "$env:USERPROFILE\Documents\mission-control",
  [string]$RepoUrl = "https://github.com/igrant9679/AIOSGV75.git",
  [string]$Branch = "main",
  [string]$Vault = "",
  [string]$Label = "",
  [ValidateSet("", "primary", "backup", "workstation")][string]$Role = "",
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$SkipModels,
  [switch]$SkipOllama,
  [switch]$InstallCodex,
  [switch]$NoCodex,
  [switch]$InstallHermes,
  [switch]$InstallOpenClaw,
  [switch]$NoCompanions,
  [switch]$NoLogin,
  [switch]$NoStart,
  [switch]$RepairOnly
)

$ErrorActionPreference = "Continue"   # native tools write progress to stderr; we check exit codes instead
$script:step = 0
$script:todo = New-Object System.Collections.Generic.List[string]
$script:done = New-Object System.Collections.Generic.List[string]
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $env:TEMP "mission-control-install-$stamp.log"
try { Start-Transcript -Path $logFile -Force | Out-Null } catch { }

function Section($t) { $script:step++; Write-Host "`n[$script:step] $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "    OK   $t" -ForegroundColor Green }
function Info($t)  { Write-Host "    ..   $t" -ForegroundColor Gray }
function Warn($t)  { Write-Host "    !!   $t" -ForegroundColor Yellow }
function Todo($t)  { Warn $t; $script:todo.Add($t) }
function Done($t)  { Ok $t; $script:done.Add($t) }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Update-SessionPath {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($m, $u, "$env:USERPROFILE\.local\bin", "$env:APPDATA\npm") | Where-Object { $_ }) -join ';'
}
function Ask($question, $default) {
  if ($Yes -or $DryRun) { return $default }
  $hint = if ($default) { " [$default]" } else { "" }
  $a = Read-Host "    $question$hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim()
}
function YesNo($question, [bool]$default) {
  if ($Yes -or $DryRun) { return $default }
  $hint = if ($default) { "(Y/n)" } else { "(y/N)" }
  $a = Read-Host "    $question $hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return ($a -match '^(y|yes)$')
}
function Invoke-Git([string[]]$a) {
  # git writes normal progress to stderr; unwrap PowerShell's error records into plain text
  $out = & git @a 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } } | Out-String
  return @{ code = $LASTEXITCODE; out = $out.Trim() }
}
function Move-Blockers($gitOutput) {
  # Hand-copied files from an older install block checkout/pull ("untracked working tree files would be
  # overwritten"). Move exactly those into a backup folder; the official versions replace them.
  if ($gitOutput -notmatch "untracked working tree files would be overwritten") { return 0 }
  $backup = Join-Path (Split-Path $RepoDir -Parent) "mc-untracked-backup-$stamp"
  $files = @(($gitOutput -split "`r?`n") | Where-Object { $_ -match '^\s+\S' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -notmatch '^(Please|Aborting|error:)' })
  $moved = 0
  foreach ($file in $files) {
    $src = Join-Path $RepoDir $file
    if (Test-Path $src) {
      $dest = Join-Path $backup $file
      New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
      Move-Item -Force $src $dest
      $moved++
    }
  }
  if ($moved) { Warn "moved $moved hand-copied file(s) to $backup (the official versions replace them)" }
  return $moved
}
function Winget-Install($id, $name) {
  if ($DryRun) { Warn "would install $name ($id) via winget"; return }
  Info "installing $name ($id)..."
  winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Host
  Update-SessionPath
}

# If this script sits next to server.cmd, we're already inside a clone.
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $PSBoundParameters.ContainsKey('RepoDir') -and (Test-Path (Join-Path $here "server.cmd"))) { $RepoDir = $here }
Update-SessionPath

# ---- shared paths + state (used across steps, so any step can be skipped) ----
# Work from TEMP so this window never holds the app folder open (reinstall/uninstall move or delete it).
Set-Location $env:TEMP
$script:later = New-Object System.Collections.Generic.List[string]
$useOllama = -not $SkipOllama
$envFile = Join-Path $RepoDir ".env.local"
$clusterFile = Join-Path $RepoDir "data\cluster.json"
$pauseFile = Join-Path $RepoDir "data\watchdog.pause"
$startupDir = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startupDir 'Mission Control Server.vbs'
$server = Join-Path $RepoDir 'server.cmd'
$WatchdogTask = 'Mission Control Watchdog'
$PeerRule = 'Mission Control LAN link'
function Set-PeerFirewall {
  # Machines on the same LAN talk directly on TCP 3101 (peer endpoints only; the app stays on 127.0.0.1:3000).
  if ($DryRun) { Warn "would allow TCP 3101 in Windows Firewall (private/domain networks) for the LAN link"; return }
  if (Get-NetFirewallRule -DisplayName $PeerRule -ErrorAction SilentlyContinue) { Ok "LAN link: firewall rule present"; return }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $add = "New-NetFirewallRule -DisplayName '$PeerRule' -Direction Inbound -Protocol TCP -LocalPort 3101 -Action Allow -Profile Domain,Private"
  if ($admin) {
    try {
      New-NetFirewallRule -DisplayName $PeerRule -Direction Inbound -Protocol TCP -LocalPort 3101 -Action Allow -Profile Domain,Private -ErrorAction Stop | Out-Null
      Done "LAN link: allowed TCP 3101 on private/work networks"
    } catch { Todo "LAN link: couldn't add the firewall rule ($($_.Exception.Message))" }
    return
  }
  # Not elevated (the normal case): only this one step needs administrator rights, so ask Windows
  # for them just for the firewall rule. Everything else keeps running as you, in your profile.
  Info "LAN link: other machines on your network reach this one on port 3101 - Windows will ask for permission to allow it"
  if (-not (YesNo "Add the Windows Firewall rule now?" $true)) { Todo "LAN link: allow TCP 3101 later - run this installer again (Modify -> Auto-start)"; return }
  try {
    $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $add)
  } catch { $p = $null }
  if (Get-NetFirewallRule -DisplayName $PeerRule -ErrorAction SilentlyContinue) { Done "LAN link: allowed TCP 3101 on private/work networks" }
  else { Todo "LAN link: the firewall rule wasn't added (permission declined?). Later, in an administrator PowerShell: $add" }
}
function Read-EnvValue($key) {
  if (-not (Test-Path $envFile)) { return $null }
  $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if ($line) { return ($line -replace "^\s*$key\s*=\s*", '').Trim('"', ' ') }
  return $null
}
function Test-Vault($p) {
  # String concat, not Join-Path: Join-Path throws when the path's drive doesn't exist
  # on this machine (e.g. a .env.local copied from a PC that has a D: drive).
  if (-not $p) { return $false }
  try { return [bool](Test-Path -LiteralPath ($p.TrimEnd('\', '/') + '\Agentic OS') -ErrorAction Stop) } catch { return $false }
}
$current = Read-EnvValue "VAULT_DIR"
$vaultDir = $Vault
if (-not $vaultDir -and (Test-Vault $current)) { $vaultDir = $current }
$script:envBackedUp = $false
function Set-EnvKey($key, $value) {
  # Set KEY=value in .env.local: replace an existing (or commented-out) line, else append. Backs up once.
  if ($DryRun -or -not (Test-Path $envFile)) { return }
  $lines = @(Get-Content $envFile)
  $active = $lines | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if ($active -and ($active -replace "^\s*$key\s*=\s*", '').Trim('"', ' ') -eq $value) { return }
  if (-not $script:envBackedUp) { Copy-Item $envFile "$envFile.bak-$stamp"; $script:envBackedUp = $true }
  $replaced = $false
  $lines = $lines | ForEach-Object {
    if (-not $replaced -and ($_ -match "^\s*$key\s*=" -or $_ -match "^\s*#\s*$key\s*=")) { $replaced = $true; "$key=$value" } else { $_ }
  }
  if (-not $replaced) { $lines = @($lines) + "$key=$value" }
  Set-Content -Path $envFile -Value $lines -Encoding UTF8
  Info "set $key in .env.local"
}
function Stop-MissionControl {
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
function Read-ClusterConfig {
  if (Test-Path $clusterFile) { try { return Get-Content $clusterFile -Raw | ConvertFrom-Json } catch { } }
  return $null
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Mission Control - Windows installer" -ForegroundColor Cyan
Write-Host "  folder:  $RepoDir" -ForegroundColor Cyan
Write-Host "  log:     $logFile" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  DRY RUN - nothing will be installed or changed" -ForegroundColor Yellow }
Write-Host "==================================================" -ForegroundColor Cyan

# ---- what to do -------------------------------------------------------------
$installed = Test-Path (Join-Path $RepoDir "package.json")
if ($Mode -eq "update") { $Mode = "install" }
if (-not $Mode) {
  if (-not $installed -or $Yes -or $DryRun) { $Mode = "install" }
  else {
    $cfg0 = Read-ClusterConfig
    $who = if ($cfg0 -and $cfg0.label) { " as '$($cfg0.label)' ($($cfg0.role))" } else { "" }
    Write-Host "`nMission Control is already installed here$who." -ForegroundColor White
    Write-Host "  1  Update / repair   (latest code, fix problems, re-check everything)"
    Write-Host "  2  Modify            (name/role, vault, Codex/Hermes/OpenClaw/models, sign-ins, auto-start)"
    Write-Host "  3  Reinstall         (fresh copy of the app; keeps your settings and keys)"
    Write-Host "  4  Uninstall"
    $choice = Read-Host "Choose 1-4 [1]"
    $Mode = switch ($choice.Trim()) { "2" { "modify" } "3" { "reinstall" } "4" { "uninstall" } default { "install" } }
  }
}
Write-Host "`nMode: $Mode" -ForegroundColor White

# Modify: pick what to change; everything else is left alone.
$sel = @{}
if ($Mode -eq "modify") {
  Write-Host "`nWhat do you want to change? (comma-separated, e.g. 1,4)" -ForegroundColor White
  Write-Host "  1  Machine name / role in the machine group"
  Write-Host "  2  Vault folder (VAULT_DIR)"
  Write-Host "  3  Tools: Codex CLI, Ollama + local models"
  Write-Host "  4  Companions: Hermes, OpenClaw"
  Write-Host "  5  Sign-ins (Claude Code, Codex)"
  Write-Host "  6  Auto-start at login + watchdog (on/off)"
  Write-Host "  7  Update the code too"
  $picks = if ($Yes -or $DryRun) { "1,2,3,4,5,6" } else { Read-Host "Change" }
  foreach ($p in ($picks -split '[,\s]+' | Where-Object { $_ })) {
    switch ($p) { "1" { $sel.group = $true } "2" { $sel.vault = $true } "3" { $sel.tools = $true } "4" { $sel.companions = $true } "5" { $sel.signin = $true } "6" { $sel.autostart = $true } "7" { $sel.app = $true } }
  }
  if ($sel.Count -eq 0) { Write-Host "Nothing selected - no changes made." -ForegroundColor Yellow; try { Stop-Transcript | Out-Null } catch { }; exit 0 }
  if ($sel.vault) { $vaultDir = $Vault }          # re-detect / re-ask
}
function Should($area) {
  if ($RepairOnly) { return ($area -eq "app") }   # repair-only touches nothing but the code
  if ($Mode -ne "modify") { return $true }
  if ($area -eq "start") { return $true }        # restart so changes apply
  return [bool]$sel[$area]
}

# ---- uninstall ----------------------------------------------------------------
function Invoke-Uninstall {
  Section "Uninstall Mission Control"
  if (-not (Test-Path $RepoDir)) { Warn "nothing installed at $RepoDir"; return }
  $cfg = Read-ClusterConfig
  Write-Host "    This stops Mission Control, removes its auto-start and watchdog, and deletes $RepoDir." -ForegroundColor White
  Write-Host "    Your vault, Claude Code, Git and Node stay. You'll be offered a backup of your settings first." -ForegroundColor White
  if (-not $Yes -and -not $DryRun) {
    $c = Read-Host "    Type UNINSTALL to continue"
    if ($c -cne "UNINSTALL") { Warn "cancelled - nothing changed"; return }
  }
  if ($DryRun) { Warn "would stop the server, remove the login launcher + watchdog task, offer to leave the group, back up data\ + .env.local, and delete $RepoDir"; return }

  Stop-MissionControl
  if (Test-Path $vbs) { Remove-Item $vbs -Force; Done "removed start-at-login" }
  if (Get-ScheduledTask -TaskName $WatchdogTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false; Done "removed the watchdog task" }
  if (Get-NetFirewallRule -DisplayName $PeerRule -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $PeerRule -ErrorAction SilentlyContinue; Done "removed the LAN firewall rule" }

  # Leave the machine group (only this machine's own files in the vault)
  if ($cfg -and $cfg.enabled -and $vaultDir) {
    if (YesNo "Remove this machine from the machine group (Fleet, Health)?" $true) {
      $cl = Join-Path $vaultDir "Agentic OS\Cluster"
      foreach ($sub in @("nodes", "health", "sessions")) {
        $f = Join-Path $cl "$sub\$($env:COMPUTERNAME).json"
        if (Test-Path $f) { Remove-Item $f -Force }
      }
      Done "left the machine group"
      $name = if ($cfg.label) { $cfg.label } else { $env:COMPUTERNAME }
      if (YesNo "Also delete this machine's shared conversations and tool-memory copies from the vault?" $false) {
        foreach ($d in @("Agentic OS\Sessions\$name", "Agentic OS\Tool Memory\$name")) {
          $p = Join-Path $vaultDir $d
          if (Test-Path $p) { Remove-Item $p -Recurse -Force }
        }
        Done "deleted this machine's shared conversations and tool memory"
      }
    }
  }

  # Back up settings + keys before the folder goes
  $bk = Join-Path (Split-Path $RepoDir -Parent) "mission-control-backup-$stamp"
  if (YesNo "Keep a backup of your settings and API keys (data\ and .env.local) in $bk ?" $true) {
    New-Item -ItemType Directory -Force $bk | Out-Null
    foreach ($keep in @("data", ".env.local")) { $src = Join-Path $RepoDir $keep; if (Test-Path $src) { Copy-Item $src (Join-Path $bk $keep) -Recurse -Force } }
    Done "backup saved to $bk (it contains API keys - keep it private)"
  }
  Remove-Item $RepoDir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $RepoDir) { Todo "couldn't delete everything in $RepoDir (a file is in use) - close any window open there and delete the folder" }
  else { Done "deleted $RepoDir" }

  # Optional: tools that were installed for it
  if ((Have codex) -and (YesNo "Also uninstall the Codex CLI?" $false)) { & npm uninstall -g @openai/codex | Out-Host; Done "Codex CLI removed" }
  if ((Have ollama) -and (YesNo "Also uninstall Ollama and its local models?" $false)) { winget uninstall --id Ollama.Ollama -e --silent | Out-Host; Done "Ollama removed" }
  if (Have openclaw) { $script:later.Add("OpenClaw is still installed - to remove it see https://docs.openclaw.ai/install (stop its gateway first: openclaw gateway stop)") }
  if (Find-HermesQuick) { $script:later.Add("Hermes is still installed - to remove it see https://hermes-agent.nousresearch.com/docs/getting-started/installation") }
  $script:later.Add("Left in place on purpose: your vault, Claude Code, Git and Node.js (other tools may use them).")
}
function Find-HermesQuick { return (Test-Path (Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\venv\Scripts\hermes.exe")) -or (Have hermes) }

if ($Mode -eq "uninstall") {
  Invoke-Uninstall
  Write-Host "`n==================================================" -ForegroundColor Green
  Write-Host "  Uninstall finished." -ForegroundColor Green
  Write-Host "==================================================" -ForegroundColor Green
  foreach ($t in $script:todo) { Write-Host "  * $t" -ForegroundColor Yellow }
  foreach ($t in $script:later) { Write-Host "  - $t" -ForegroundColor Gray }
  Write-Host "  Log: $logFile" -ForegroundColor Gray
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}

# Reinstall: move the current app aside (the clone step below copies data\ and .env.local back).
if ($Mode -eq "reinstall" -and (Test-Path $RepoDir)) {
  $old = "$RepoDir.old-$stamp"
  if ($DryRun) { Warn "would move $RepoDir to $old and install a fresh copy (keeping data\ and .env.local)" }
  else {
    Stop-MissionControl
    Start-Sleep -Seconds 2
    try { Move-Item $RepoDir $old -ErrorAction Stop; Info "moved the old install to $old" }
    catch { Write-Host "Couldn't move $RepoDir (a file is in use - close windows and editors open there): $($_.Exception.Message)" -ForegroundColor Red; try { Stop-Transcript | Out-Null } catch { }; exit 1 }
  }
}

# ---- 1. Windows + winget --------------------------------------------------
do { if (-not (Should "prereqs")) { break }
Section "Windows + package manager"
if ([Environment]::OSVersion.Platform -ne "Win32NT") { Write-Host "This installer is for Windows." -ForegroundColor Red; exit 1 }
Ok "Windows $([Environment]::OSVersion.Version)"
if (Have winget) { Ok "winget present" }
else {
  Todo "winget (App Installer) is missing - install 'App Installer' from the Microsoft Store, then run this installer again."
  if (-not $DryRun) { try { Stop-Transcript | Out-Null } catch { }; Read-Host "Press Enter to close"; exit 1 }
}

} while ($false)

# ---- 2. Git ---------------------------------------------------------------
do { if (-not (Should "prereqs")) { break }
Section "Git"
if (Have git) { Ok "git $((& git --version) -replace 'git version ','')" }
else { Winget-Install "Git.Git" "Git"; if (Have git) { Done "Git installed" } elseif (-not $DryRun) { Todo "Git didn't land on PATH - open a NEW PowerShell window and run the installer again." } }

} while ($false)

# ---- 3. Node.js -----------------------------------------------------------
do { if (-not (Should "prereqs")) { break }
Section "Node.js (22.15 or newer)"
function NodeVersion { if (Have node) { return [version](((& node --version) -replace '^v', '').Trim()) } return $null }
$nv = NodeVersion
if (-not $nv) { Winget-Install "OpenJS.NodeJS.LTS" "Node.js LTS"; $nv = NodeVersion }
elseif ($nv -lt [version]"22.15.0") {
  Warn "Node $nv is too old (reading Codex session files needs 22.15+)"
  if (-not $DryRun) {
    Info "upgrading Node.js LTS..."
    winget upgrade --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Host
    if ($LASTEXITCODE -ne 0) { winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent --force | Out-Host }
    Update-SessionPath; $nv = NodeVersion
  }
}
if ($nv -and $nv -ge [version]"22.15.0") { Ok "Node $nv" }
elseif (-not $DryRun) { Todo "Node.js 22.15+ isn't available yet - open a NEW PowerShell window and run the installer again." }

} while ($false)

# ---- 4. Ollama ------------------------------------------------------------
do { if (-not (Should "tools")) { break }
Section "Ollama (free local models + vault search embeddings)"
if ($SkipOllama) { Info "skipped (-SkipOllama)" }
elseif (Have ollama) { Ok "ollama present" }
elseif (YesNo "Install Ollama? Recommended - powers semantic vault search and free local models." $true) {
  Winget-Install "Ollama.Ollama" "Ollama"; if (Have ollama) { Done "Ollama installed" }
} else { $useOllama = $false; Info "skipped" }

} while ($false)

# ---- 5. The app: clone or repair ------------------------------------------
do { if (-not (Should "app")) { break }
Section "Mission Control app"
$isRepo = Test-Path (Join-Path $RepoDir ".git")
if (-not $isRepo -and (Test-Path $RepoDir) -and (Get-ChildItem $RepoDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  # A copied (non-git) install: keep its settings, replace the code with a real clone.
  $old = "$RepoDir.old-$stamp"
  if ($DryRun) { Warn "folder exists but isn't a git clone - would move it to $old, clone fresh, and carry over data\ and .env.local" }
  else {
    Warn "folder exists but isn't a git clone - moving it to $old and cloning fresh (data\ and .env.local are carried over)"
    Move-Item $RepoDir $old
  }
}
if (-not (Test-Path (Join-Path $RepoDir ".git"))) {
  if ($DryRun) { Warn "would clone $RepoUrl -> $RepoDir" }
  else {
    Info "cloning $RepoUrl ..."
    & git clone --branch $Branch $RepoUrl $RepoDir | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "git clone failed - check your internet connection and run again." -ForegroundColor Red; try { Stop-Transcript | Out-Null } catch { }; Read-Host "Press Enter to close"; exit 1 }
    if ($old -and (Test-Path $old)) {
      foreach ($keep in @("data", ".env.local")) {
        $src = Join-Path $old $keep
        if (Test-Path $src) { Copy-Item $src (Join-Path $RepoDir $keep) -Recurse -Force; Info "carried over $keep" }
      }
    }
    Done "cloned into $RepoDir"
  }
} else {
  Ok "clone exists at $RepoDir"
  if (-not $DryRun) {
    Push-Location $RepoDir
    # GitHub link
    $r = Invoke-Git @("remote", "get-url", "origin")
    if ($r.code -ne 0) { Invoke-Git @("remote", "add", "origin", $RepoUrl) | Out-Null; Info "added the GitHub remote (origin)" }
    $r = Invoke-Git @("fetch", "origin")
    if ($r.code -ne 0) { Warn "git fetch failed: $($r.out)" }
    # On the right branch, linked to GitHub
    $cur = (Invoke-Git @("branch", "--show-current")).out
    if ($cur -ne $Branch) {
      $hasLocal = (Invoke-Git @("rev-parse", "--verify", "--quiet", "refs/heads/$Branch")).code -eq 0
      $args1 = if ($hasLocal) { @("checkout", $Branch) } else { @("checkout", "-b", $Branch, "origin/$Branch") }
      $r = Invoke-Git $args1
      if ($r.code -ne 0 -and (Move-Blockers $r.out) -gt 0) { $r = Invoke-Git $args1 }
      if ($r.code -eq 0) { Info "switched from '$cur' to '$Branch'" } else { Todo "couldn't switch to '$Branch' (local changes?): $($r.out)" }
    }
    Invoke-Git @("branch", "--set-upstream-to=origin/$Branch", $Branch) | Out-Null
    # Pull; move aside untracked files that block it (hand-copied files from an older install)
    $r = Invoke-Git @("pull", "--ff-only")
    if ($r.code -ne 0 -and (Move-Blockers $r.out) -gt 0) { $r = Invoke-Git @("pull", "--ff-only") }
    if ($r.code -eq 0) { Done "code is up to date ($((Invoke-Git @('log','-1','--format=%h %s')).out))" }
    else { Todo "git pull failed - run 'git status' in $RepoDir and fix what it reports, then run the installer again. Details: $($r.out)" }
    Pop-Location
  }
}
if ($RepairOnly) {
  Write-Host "`n-RepairOnly: code repaired/updated; nothing else changed." -ForegroundColor Green
  foreach ($t in $script:todo) { Write-Host "  * $t" -ForegroundColor Yellow }
  try { Stop-Transcript | Out-Null } catch { }
  if ($script:todo.Count) { exit 1 } else { exit 0 }
}

} while ($false)

# ---- 6. Dependencies + build ----------------------------------------------
do { if (-not (Should "app")) { break }
Section "Dependencies + build"
if ($DryRun) { Warn "would stop a running Mission Control on port 3000, run npm install + npm run build, then restart it" }
elseif (Test-Path (Join-Path $RepoDir "package.json")) {
  Push-Location $RepoDir
  # Pause the watchdog and stop the server so the build can replace its files.
  New-Item -ItemType Directory -Force (Join-Path $RepoDir "data") | Out-Null
  Set-Content -Path $pauseFile -Value "installer" -Encoding Ascii
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Info "npm install (a few minutes the first time)..."
  & npm install --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { Todo "npm install failed - see the log: $logFile" }
  else {
    Info "npm run build..."
    & npm run build | Out-Host
    if ($LASTEXITCODE -eq 0) { Done "app built" } else { Todo "build failed - see the log: $logFile" }
  }
  Pop-Location
} else { Todo "app folder has no package.json - the clone step didn't complete" }

} while ($false)

# ---- 7. Local models ------------------------------------------------------
do { if (-not (Should "tools")) { break }
Section "Local models (llama3.2 + nomic-embed-text)"
if ($SkipModels -or -not $useOllama) { Info "skipped" }
elseif (Have ollama) {
  $have = (& ollama list 2>$null) | Out-String
  foreach ($m in @('llama3.2', 'nomic-embed-text')) {
    if ($have -match [regex]::Escape($m)) { Ok "$m already pulled" }
    elseif ($DryRun) { Warn "would pull $m" }
    else { Info "pulling $m (can take a while)..."; & ollama pull $m | Out-Host; if ($LASTEXITCODE -eq 0) { Done "pulled $m" } else { Todo "couldn't pull $m - run 'ollama pull $m' later" } }
  }
} else { Todo "Ollama isn't on PATH yet - open a new window and run 'ollama pull nomic-embed-text' later" }

} while ($false)

# ---- 8. Agent CLIs --------------------------------------------------------
do { if (-not (Should "prereqs")) { break }
Section "Claude Code CLI (required)"
if (Have claude) { Ok "claude present" }
elseif ($DryRun) { Warn "would install Claude Code with the official installer (claude.ai/install.ps1)" }
else {
  Info "installing Claude Code..."
  try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Warn "installer error: $($_.Exception.Message)" }
  Update-SessionPath
  if (Have claude) { Done "Claude Code installed" } else { Todo "Claude Code didn't install - see https://claude.com/claude-code, then run this installer again" }
}

} while ($false)

# ---- 8b. Codex CLI ------------------------------------------------------------
do { if (-not (Should "tools")) { break }
Section "Codex CLI (optional - uses your ChatGPT subscription)"
if (Have codex) { Ok "codex present" }
elseif ($NoCodex) { Info "skipped (-NoCodex)" }
elseif ($InstallCodex -or (YesNo "Install the Codex CLI?" $false)) {
  if ($DryRun) { Warn "would run: npm install -g @openai/codex" }
  else { & npm install -g @openai/codex | Out-Host; Update-SessionPath; if (Have codex) { Done "Codex installed" } else { Todo "Codex didn't install - run 'npm install -g @openai/codex' later" } }
} else { Info "skipped" }

} while ($false)

# ---- 9. Obsidian vault -----------------------------------------------------
do { if (-not (Should "vault")) { break }
Section "Obsidian vault (the shared brain)"
function Find-Vaults {
  $roots = New-Object System.Collections.Generic.List[string]
  foreach ($v in @($env:OneDriveCommercial, $env:OneDrive, $env:OneDriveConsumer)) { if ($v -and (Test-Path $v)) { $roots.Add($v) } }
  Get-ChildItem $env:USERPROFILE -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @('AppData', 'node_modules', '.git') } | ForEach-Object { $roots.Add($_.FullName) }
  Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -ne "C:\" -and $_.Used -gt 0 } | ForEach-Object { $roots.Add($_.Root) }
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($r in ($roots | Select-Object -Unique)) {
    Get-ChildItem $r -Directory -Recurse -Depth 5 -Filter "Agentic OS" -ErrorAction SilentlyContinue | ForEach-Object {
      $v = $_.Parent.FullName
      if (-not $found.Contains($v)) { $found.Add($v) }
    }
  }
  # the real shared vault first
  return $found | Sort-Object { if ($_ -match 'IdrisGV75') { 0 } else { 1 } }, Length
}
$current = $null
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*VAULT_DIR\s*=' } | Select-Object -First 1
  if ($line) { $current = ($line -replace '^\s*VAULT_DIR\s*=\s*', '').Trim('"', ' ') }
}
if ($Mode -eq "modify") { $vaultDir = $Vault }
if (-not $vaultDir -and $Mode -ne "modify" -and (Test-Vault $current)) { $vaultDir = $current; Ok "VAULT_DIR already points at the vault: $current" }
if (-not $vaultDir -and $current -and -not (Test-Vault $current)) { Warn "VAULT_DIR in .env.local is '$current', which doesn't exist on this machine (copied from another PC?)" }
if (-not $vaultDir) {
  Info "looking for the synced vault (a folder containing 'Agentic OS')..."
  $cands = @(Find-Vaults)
  if ($cands.Count -gt 0) {
    for ($i = 0; $i -lt [Math]::Min($cands.Count, 6); $i++) { Info "  [$($i + 1)] $($cands[$i])" }
    $pick = Ask "Use which vault? (number, or paste a path)" "1"
    if ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $cands.Count) { $vaultDir = $cands[[int]$pick - 1] } else { $vaultDir = $pick }
  } else {
    Warn "no vault found. Sync the 'AI Mission Control\IdrisGV75' folder with OneDrive first (LSI Media LLC library)."
    Info "  1. Sign in to OneDrive on this PC (as this Windows user) with your LSI Media account"
    Info "  2. In SharePoint, open the 'Working Files Idris' library -> AI Mission Control -> IdrisGV75 -> 'Sync' (or 'Add shortcut to My files')"
    Info "  3. Wait until 'Agentic OS' appears in File Explorer, then paste that IdrisGV75 path below or re-run the installer"
    $vaultDir = Ask "Paste the vault path now, or press Enter to set it later" ""
  }
}
if ($vaultDir -and -not (Test-Vault $vaultDir)) { Warn "'$vaultDir' has no 'Agentic OS' folder - that's not the vault"; $vaultDir = "" }
if ($vaultDir) {
  Ok "vault: $vaultDir"
  # OneDrive "Always keep on this device": cloud-only placeholders make the brain slow or missing offline.
  $probe = Get-ChildItem (Join-Path $vaultDir "Agentic OS") -File -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 25
  $cloudOnly = @($probe | Where-Object { ([int]$_.Attributes -band 0x400000) -or ([int]$_.Attributes -band 0x1000) }).Count
  if ($cloudOnly -gt 0) {
    Warn "$cloudOnly vault file(s) are cloud-only (not downloaded)"
    if (YesNo "Pin the vault to this device ('Always keep on this device')?" $true) {
      if ($DryRun) { Warn "would run: attrib +P -U on the vault" } else { & attrib.exe +P -U "$vaultDir\*" /S /D | Out-Null; Done "vault pinned - OneDrive downloads it in the background" }
    } else { Todo "Right-click the vault folder in File Explorer -> 'Always keep on this device'" }
  } else { Ok "vault files are on this device" }
} else { Todo "Set VAULT_DIR in $envFile to the synced vault (the folder containing 'Agentic OS'), then run update.cmd" }

} while ($false)

# ---- 10. .env.local --------------------------------------------------------
do { if (-not (Should "vault")) { break }
Section "Machine config (.env.local)"
if ($DryRun) { Warn "would write/update $envFile (VAULT_DIR + local embeddings)" }
elseif (Test-Path $envFile) {
  if ($vaultDir -and $vaultDir -ne $current) { Set-EnvKey "VAULT_DIR" $vaultDir; Done "updated VAULT_DIR (backup: .env.local.bak-$stamp)" }
  else { Ok ".env.local present" }
} elseif (Test-Path $RepoDir) {
  $v = if ($vaultDir) { $vaultDir } else { "<SET-ME: the synced vault folder that contains 'Agentic OS'>" }
  $embed = if ($useOllama) { @("EMBED_BASE_URL=http://localhost:11434/v1", "EMBED_MODEL=nomic-embed-text") } else { @("# EMBED_BASE_URL=http://localhost:11434/v1", "# EMBED_MODEL=nomic-embed-text") }
  $lines = @(
    "# Obsidian vault - the OneDrive-synced folder that contains 'Agentic OS'.",
    "VAULT_DIR=$v",
    "",
    "# Semantic vault search via local Ollama embeddings (keyless, localhost).",
    $embed,
    "",
    "# Telegram: only the master machine needs these (see the Guide).",
    "# TELEGRAM_BOT_TOKEN=",
    "",
    "# Companion agents - uncomment once installed on this machine:",
    "# OPENCLAW_CMD=openclaw agent --agent main --message {input}",
    "# HERMES_BIN=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe",
    "# HERMES_CMD=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe -z {input}"
  ) | ForEach-Object { $_ }
  Set-Content -Path $envFile -Value $lines -Encoding UTF8
  Done "wrote .env.local"
}

} while ($false)

# ---- 11. Machine group -----------------------------------------------------
do { if (-not (Should "group")) { break }
Section "Machine group (shares sessions, health and jobs through the vault)"
$cfg = $null
if (Test-Path $clusterFile) { try { $cfg = Get-Content $clusterFile -Raw | ConvertFrom-Json } catch { } }
if ($cfg -and $cfg.enabled -and -not $Label -and -not $Role -and $Mode -ne "modify") {
  Ok "already in the group as '$($cfg.label)' ($($cfg.role))"
} elseif (-not $vaultDir) {
  Todo "Join the machine group later (Settings -> Machine Group & Roles) once the vault is set"
} elseif (YesNo "Join the machine group?" $true) {
  # Who's already primary?
  $livePrimary = $null
  $nodesDir = Join-Path $vaultDir "Agentic OS\Cluster\nodes"
  Get-ChildItem $nodesDir -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object {
    try { $n = Get-Content $_.FullName -Raw | ConvertFrom-Json; if ($n.role -eq "primary" -and $n.host -ne $env:COMPUTERNAME) { $livePrimary = $n.label } } catch { }
  }
  $defaultLabel = if ($Label) { $Label } elseif ($cfg -and $cfg.label) { $cfg.label } else { $env:COMPUTERNAME }
  $name = Ask "Display name for this machine" $defaultLabel
  if ($livePrimary) { Info "the group's primary is $livePrimary" }
  Info "roles: workstation = shares + works, never runs scheduled jobs (recommended)"
  Info "       backup      = also takes over jobs while the primary is down"
  Info "       primary     = runs the scheduled jobs (only ONE machine)"
  $defaultRole = if ($Role) { $Role } elseif ($cfg -and $cfg.role) { $cfg.role } else { "workstation" }
  $r = (Ask "Role (workstation / backup / primary)" $defaultRole).ToLower()
  if ($r -notin @("workstation", "backup", "primary")) { $r = "workstation" }
  if ($r -eq "primary" -and $livePrimary) { Warn "$livePrimary is already primary - two primaries fight over the jobs"; if (-not (YesNo "Make this machine primary anyway?" $false)) { $r = "backup" } }
  if ($DryRun) { Warn "would write data\cluster.json: $name / $r" }
  else {
    New-Item -ItemType Directory -Force (Split-Path $clusterFile) | Out-Null
    $json = @{ enabled = $true; role = $r; installDir = $RepoDir; label = $name } | ConvertTo-Json
    Set-Content -Path $clusterFile -Value $json -Encoding UTF8
    Done "joined the machine group as '$name' ($r)"
  }
} else { Info "skipped - this machine runs on its own (join later in Settings -> Machine Group & Roles)" }

} while ($false)

# ---- 11b. Companions: Ollama autostart, Hermes, OpenClaw --------------------
do { if (-not (Should "companions")) { break }
Section "Companions (start automatically with Mission Control)"
# Ollama: its own login entry, plus Mission Control's service supervisor starts 'ollama serve' if it's down.
if ($useOllama -and (Have ollama)) {
  $ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
  $hasEntry = (Test-Path (Join-Path $startupDir "Ollama.lnk")) -or [bool](Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | Where-Object { $_.Command -match 'ollama' })
  if ($hasEntry) { Ok "Ollama starts at login" }
  elseif (Test-Path $ollamaApp) {
    if ($DryRun) { Warn "would add Ollama to Startup" }
    else {
      $sc = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startupDir "Ollama.lnk"))
      $sc.TargetPath = $ollamaApp; $sc.WorkingDirectory = (Split-Path $ollamaApp); $sc.Save()
      Done "Ollama set to start at login"
    }
  } else { Info "Ollama login entry not found - Mission Control starts 'ollama serve' itself when it boots" }
}
# Hermes (Nous Research): goal mode + Control Room. Optional. Official installer; Mission Control
# then starts its dashboard automatically (service supervisor) once HERMES_BIN is set.
$HermesDocs = "https://hermes-agent.nousresearch.com/docs/getting-started/installation"
$OpenClawDocs = "https://docs.openclaw.ai/install"
function Find-Hermes {
  $p = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\venv\Scripts\hermes.exe"
  if (Test-Path $p) { return $p }
  $c = Get-Command hermes -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}
$hermesExe = Find-Hermes
if (-not $hermesExe -and -not $NoCompanions) {
  Info "Hermes (Nous Research agent: goal mode + Control Room) - optional"
  Info "  docs: $HermesDocs"
  $wantHermes = $InstallHermes -or (YesNo "Install Hermes now with its official installer? (downloads Python + tools, ~5-10 min)" $false)
  if ($wantHermes) {
    if ($DryRun) { Warn "would run: iex (irm https://hermes-agent.nousresearch.com/install.ps1)" }
    else {
      Info "running the official Hermes installer..."
      try { Invoke-Expression (Invoke-RestMethod https://hermes-agent.nousresearch.com/install.ps1) } catch { Warn "Hermes installer error: $($_.Exception.Message)" }
      Update-SessionPath
      $hermesExe = Find-Hermes
      if (-not $hermesExe) { Todo "Hermes didn't finish installing - see $HermesDocs, then run this installer again (Modify) to wire it up" }
    }
  } else { $script:later.Add("Hermes (optional): in PowerShell run   iex (irm https://hermes-agent.nousresearch.com/install.ps1)   then run this installer again -> Modify.  Docs: $HermesDocs") }
}
if ($hermesExe) {
  Set-EnvKey "HERMES_BIN" $hermesExe
  Set-EnvKey "HERMES_CMD" "$hermesExe -z {input}"
  Done "Hermes wired up - Mission Control starts its dashboard automatically ($hermesExe)"
}

# OpenClaw: Telegram gateway + approvals from your phone. PRIMARY machine only - two gateways
# polling one bot steal each other's messages. Its installer runs onboarding; --install-daemon
# makes the gateway start automatically.
$myRole = if (Test-Path $clusterFile) { try { (Get-Content $clusterFile -Raw | ConvertFrom-Json).role } catch { "" } } else { "" }
$isPrimary = ($myRole -eq "primary") -or -not (Test-Path $clusterFile)
if (Have openclaw) {
  Set-EnvKey "OPENCLAW_CMD" "openclaw agent --agent main --message {input}"
  Ok "OpenClaw present"
  if (-not $isPrimary) { Warn "this isn't the primary machine - keep the OpenClaw Telegram gateway OFF here (openclaw gateway stop)" }
} elseif ($isPrimary -and -not $NoCompanions) {
  Info "OpenClaw (Telegram gateway + approvals from your phone) - optional, primary machine only"
  Info "  docs: $OpenClawDocs"
  $wantClaw = $InstallOpenClaw -or (YesNo "Install OpenClaw now with its official installer? (it opens a setup wizard: model, Telegram bot)" $false)
  if ($wantClaw) {
    if ($DryRun) { Warn "would run: iwr -useb https://openclaw.ai/install.ps1 | iex   then: openclaw onboard --install-daemon" }
    else {
      Info "running the official OpenClaw installer (follow its wizard)..."
      try { Invoke-Expression (Invoke-WebRequest -UseBasicParsing https://openclaw.ai/install.ps1).Content } catch { Warn "OpenClaw installer error: $($_.Exception.Message)" }
      Update-SessionPath
      if (Have openclaw) {
        Set-EnvKey "OPENCLAW_CMD" "openclaw agent --agent main --message {input}"
        Done "OpenClaw installed"
        & openclaw gateway status 2>&1 | Out-Host
        $script:later.Add("OpenClaw: if the gateway isn't running yet, run   openclaw onboard --install-daemon   (starts it automatically), then pair your Telegram bot. Mission Control's approval protocol: Guide -> Installing Companions. Docs: $OpenClawDocs")
      } else { Todo "OpenClaw didn't finish installing - see $OpenClawDocs, then run this installer again (Modify)" }
    }
  } else { $script:later.Add("OpenClaw (optional, primary only): in PowerShell run   iwr -useb https://openclaw.ai/install.ps1 | iex   then   openclaw onboard --install-daemon.  Docs: $OpenClawDocs") }
} else { Info "OpenClaw: not on this machine (only the primary runs the Telegram gateway)" }

} while ($false)

# ---- 12. Sign-ins ----------------------------------------------------------
do { if (-not (Should "signin")) { break }
Section "Sign in (Claude Code + Codex) - opens your browser"
function Claude-SignedIn {
  if (-not (Have claude)) { return $false }
  $o = & claude auth status --json 2>$null | Out-String
  try { return [bool]((($o.Substring($o.IndexOf('{'))) | ConvertFrom-Json).loggedIn) } catch { return $false }
}
if (-not (Have claude)) { Info "claude not installed - skipped" }
elseif (Claude-SignedIn) { Ok "Claude Code: signed in" }
elseif ($NoLogin -or $Yes -or $DryRun) { Todo "Sign in to Claude Code: open PowerShell and run 'claude auth login'" }
elseif (YesNo "Claude Code is signed out. Sign in now?" $true) {
  & claude auth login
  if (Claude-SignedIn) { Done "Claude Code signed in" } else { Todo "Claude Code still signed out - run 'claude auth login' later" }
} else { Todo "Sign in to Claude Code: run 'claude auth login'" }

if (Have codex) {
  $cs = & codex login status 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -and $cs -match 'Logged in') { Ok "Codex: signed in" }
  elseif ($NoLogin -or $Yes -or $DryRun) { Todo "Sign in to Codex: run 'codex login'" }
  elseif (YesNo "Codex is signed out. Sign in now?" $true) {
    & codex login
    $cs = & codex login status 2>&1 | Out-String
    if ($cs -match 'Logged in') { Done "Codex signed in" } else { Todo "Codex still signed out - run 'codex login' later" }
  } else { Todo "Sign in to Codex: run 'codex login'" }
}

} while ($false)

# ---- 13. Auto-start + watchdog ----------------------------------------------
do { if (-not (Should "autostart")) { break }
Section "Auto-start at login + watchdog"
$wantAuto = $true
if ($Mode -eq "modify") { $wantAuto = YesNo "Start Mission Control automatically at login (with the watchdog)?" $true }
if (-not $wantAuto) {
  if ($DryRun) { Warn "would remove the login launcher and the watchdog task" }
  else {
    if (Test-Path $vbs) { Remove-Item $vbs -Force }
    if (Get-ScheduledTask -TaskName $WatchdogTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false }
    Done "auto-start and watchdog turned off - start it with server.cmd when you need it"
  }
}
elseif ($DryRun) { Warn "would register the '$WatchdogTask' task (starts the server at login, restarts it within 5 minutes)" }
else {
  # One Scheduled Task does both jobs (no .vbs launcher: Smart App Control blocks those).
  # watchdog.ps1 -Install also removes an old Startup-folder launcher.
  $wd = Join-Path $RepoDir 'watchdog.ps1'
  if (Test-Path $wd) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $wd -Install | Out-Host
    if ($LASTEXITCODE -eq 0) { Done "starts hidden at every login, and restarts within 5 minutes if it ever stops" } else { Todo "the '$WatchdogTask' task didn't register - run install-watchdog.cmd" }
  } else { Todo "watchdog.ps1 is missing from $RepoDir - run update.cmd, then install-watchdog.cmd" }
  # LAN link between machines: let the peer listener (TCP 3101) through Windows Firewall on private/work networks
  Set-PeerFirewall
}

} while ($false)

# ---- 14. Start + verify -----------------------------------------------------
do { if (-not (Should "start")) { break }
Section "Start + health check"
if (Test-Path $pauseFile) { Remove-Item $pauseFile -Force -ErrorAction SilentlyContinue }
if ($DryRun -or $NoStart) { Info "skipped" }
elseif (Test-Path $server) {
  if ($Mode -eq "modify") { Info "restarting so the changes apply..."; Stop-MissionControl; Start-Sleep -Seconds 2 }
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    # Prefer the task: it starts the server as you, not elevated, even from an admin window.
    if (Get-ScheduledTask -TaskName $WatchdogTask -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $WatchdogTask }
    else { Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$server`"" -WindowStyle Hidden -WorkingDirectory $RepoDir }
  }
  Info "waiting for http://127.0.0.1:3000 ..."
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    try { $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/ ; $up = ($resp.StatusCode -eq 200) } catch { Start-Sleep -Seconds 3 }
  }
  if (-not $up) { Todo "Mission Control didn't answer on port 3000 - run server.cmd in $RepoDir to see why" }
  else {
    Done "Mission Control is running"
    try {
      $h = Invoke-RestMethod -Method Post -TimeoutSec 90 -ContentType "application/json" -Body '{"action":"run"}' http://127.0.0.1:3000/api/health
      foreach ($c in $h.report.checks) {
        $line = "{0,-34} {1}" -f $c.label, $c.detail
        if ($line.Length -gt 140) { $line = $line.Substring(0, 137) + "..." }
        switch ($c.level) {
          "ok"   { Write-Host "    OK   $line" -ForegroundColor Green }
          "warn" { Write-Host "    !!   $line" -ForegroundColor Yellow }
          "info" { Write-Host "    i    $line" -ForegroundColor Magenta }
          "fail" { Write-Host "    XX   $line" -ForegroundColor Red; if ($c.fix) { $script:todo.Add("$($c.label): $($c.fix)") } }
          default { Write-Host "    --   $line" -ForegroundColor DarkGray }
        }
      }
    } catch { Warn "couldn't read the health report: $($_.Exception.Message)" }
    Start-Process "http://127.0.0.1:3000/command"
  }
}

} while ($false)

# ---- summary ---------------------------------------------------------------
Write-Host "`n==================================================" -ForegroundColor Green
$verb = switch ($Mode) { "modify" { "Changes applied" } "reinstall" { "Reinstalled" } default { "Installed" } }
if ($DryRun) { Write-Host "  Dry run finished - nothing was changed." -ForegroundColor Green }
elseif ($script:todo.Count -eq 0) { Write-Host "  All done - $verb. Mission Control is running." -ForegroundColor Green }
else { Write-Host "  $verb, with $($script:todo.Count) thing(s) left for you:" -ForegroundColor Yellow }
Write-Host "==================================================" -ForegroundColor Green
foreach ($t in $script:todo) { Write-Host "  * $t" -ForegroundColor Yellow }
if ($script:later.Count) {
  Write-Host "`n  Optional next steps:" -ForegroundColor White
  foreach ($t in $script:later) { Write-Host "  - $t" -ForegroundColor Gray }
}
Write-Host @"

  Dashboard:  http://127.0.0.1:3000/command   (Guide -> "Install, update & uninstall" has all of this)
  Run again:  this installer (or install.cmd in $RepoDir) to update, modify, reinstall or uninstall
  Optional:   Studio / WordPress keys in Settings
  Log:        $logFile
"@ -ForegroundColor Gray
if ($Mode -eq "reinstall" -and $old -and (Test-Path $old)) { Write-Host "  The previous install is in $old - delete it once everything works." -ForegroundColor Gray }
try { Stop-Transcript | Out-Null } catch { }
