<#
  Mission Control - full Windows installer / bootstrapper.

  Installs the prerequisites (Git, Node.js LTS, Ollama), the app (clone + build),
  local models, optional agent CLIs (Claude Code, Codex), a starter .env.local,
  and the auto-start service. Idempotent: re-run any time to repair/update.

  Fresh machine (repo is public):
    irm https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1 -OutFile "$env:TEMP\mc-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\mc-install.ps1"

  From inside a clone: double-click install.cmd, or  powershell -ExecutionPolicy Bypass -File install.ps1

  Flags: -DryRun (report only), -SkipModels, -InstallCodex, -Yes (accept defaults),
         -RepoDir <path>, -Vault <path>
#>
param(
  [string]$RepoDir = "$env:USERPROFILE\Documents\mission-control",
  [string]$RepoUrl = "https://github.com/igrant9679/AIOSGV75.git",
  [string]$Vault = "",
  [switch]$DryRun,
  [switch]$SkipModels,
  [switch]$InstallCodex,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$script:step = 0
function Section($t) { $script:step++; Write-Host "`n[$script:step] $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "    OK   $t" -ForegroundColor Green }
function Info($t)  { Write-Host "    ..   $t" -ForegroundColor Gray }
function Warn($t)  { Write-Host "    !!   $t" -ForegroundColor Yellow }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Update-SessionPath {
  $m = [Environment]::GetEnvironmentVariable('Path','Machine')
  $u = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = (@($m,$u) | Where-Object { $_ } ) -join ';'
}

# If this script sits next to server.cmd, we're already inside a clone.
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (Test-Path (Join-Path $here "server.cmd")) { $RepoDir = $here }

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Mission Control - Windows installer" -ForegroundColor Cyan
Write-Host "  target folder: $RepoDir" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  DRY RUN - nothing will be installed or changed" -ForegroundColor Yellow }
Write-Host "==================================================" -ForegroundColor Cyan

# ---- 1. winget ------------------------------------------------------------
Section "Package manager (winget)"
if (Have winget) { Ok "winget present" }
else {
  Warn "winget (App Installer) is missing. Install 'App Installer' from the Microsoft Store, then re-run."
  if (-not $DryRun) { throw "winget required" }
}

# ---- 2. prerequisites via winget -----------------------------------------
function Ensure-Tool($cmd, $id, $name) {
  if (Have $cmd) { Ok "$name present ($((Get-Command $cmd).Source))"; return }
  if ($DryRun) { Warn "$name MISSING - would install $id via winget"; return }
  Info "installing $name ($id)..."
  winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements --silent
  Update-SessionPath
  if (Have $cmd) { Ok "$name installed" } else { Warn "$name still not on PATH - you may need to open a NEW terminal and re-run" }
}
Section "Git";      Ensure-Tool "git"    "Git.Git"          "Git"
Section "Node.js";  Ensure-Tool "node"   "OpenJS.NodeJS.LTS" "Node.js LTS"
if (Have node) {
  $nv = (& node --version) -replace 'v',''
  $maj = [int]($nv.Split('.')[0])
  if ($maj -lt 18) { Warn "Node $nv is old - Mission Control wants 18+ (20/22 ideal)" } else { Ok "Node $nv" }
}
Section "Ollama (local models + embeddings)"; Ensure-Tool "ollama" "Ollama.Ollama" "Ollama"

# ---- 3. the app: clone or update -----------------------------------------
Section "Mission Control app"
if (Test-Path (Join-Path $RepoDir ".git")) {
  Ok "clone exists at $RepoDir"
  if (-not $DryRun) { Info "git pull..."; Push-Location $RepoDir; git pull; Pop-Location }
} else {
  if ($DryRun) { Warn "would clone $RepoUrl -> $RepoDir" }
  else {
    Info "cloning $RepoUrl ..."
    git clone $RepoUrl $RepoDir
  }
}

# ---- 4. build -------------------------------------------------------------
Section "Install dependencies + build"
if ($DryRun) { Warn "would run: npm install ; npm run build (in $RepoDir)" }
elseif (Test-Path $RepoDir) {
  Push-Location $RepoDir
  Info "npm install..."; & npm install
  Info "npm run build..."; & npm run build
  Pop-Location
  Ok "app built"
}

# ---- 5. local models ------------------------------------------------------
Section "Local models (llama3.2 + nomic-embed-text)"
if ($SkipModels) { Info "skipped (-SkipModels)" }
elseif ($DryRun) { Warn "would pull: llama3.2, nomic-embed-text" }
elseif (Have ollama) {
  $have = (& ollama list) 2>$null | Out-String
  foreach ($m in @('llama3.2','nomic-embed-text')) {
    if ($have -match [regex]::Escape($m)) { Ok "$m already pulled" }
    else { Info "pulling $m (this can take a while)..."; & ollama pull $m }
  }
} else { Warn "Ollama not available - skipping models" }

# ---- 6. Claude Code CLI (the operator) -----------------------------------
Section "Claude Code CLI"
if (Have claude) { Ok "claude present ($((Get-Command claude).Source))" }
elseif ($DryRun) { Warn "MISSING - would install via the official installer (irm https://claude.ai/install.ps1 | iex)" }
else {
  Info "installing Claude Code..."
  try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Update-SessionPath } catch { Warn "auto-install failed: $($_.Exception.Message)" }
  if (Have claude) { Ok "claude installed" } else { Warn "install 'claude' manually, then run: claude  ->  /login" }
}
Warn "ACTION NEEDED: run 'claude' once in a terminal and do /login (browser sign-in) - can't be automated."

# ---- 7. Codex CLI (optional) ---------------------------------------------
Section "Codex CLI (optional)"
$doCodex = $InstallCodex
if (-not $doCodex -and -not $Yes -and -not $DryRun -and -not (Have codex)) {
  $doCodex = (Read-Host "    Install the Codex CLI too? (y/N)") -match '^(y|yes)$'
}
if (Have codex) { Ok "codex present" }
elseif ($DryRun) { Info "optional - would install @openai/codex via npm if requested" }
elseif ($doCodex -and (Have npm)) { Info "npm install -g @openai/codex..."; & npm install -g @openai/codex; Warn "run 'codex login' once to authenticate" }
else { Info "skipped" }

# ---- 8. .env.local --------------------------------------------------------
Section "Machine config (.env.local)"
$envFile = Join-Path $RepoDir ".env.local"
if (Test-Path $envFile) { Ok ".env.local already present - leaving it as-is" }
elseif ($DryRun) { Warn "would create a starter .env.local (VAULT_DIR + local embeddings)" }
else {
  $vaultDir = $Vault
  if (-not $vaultDir -and -not $Yes) {
    Write-Host "    Where is your synced Obsidian vault (the OneDrive 'AI Mission Control\IdrisGV75' folder)?" -ForegroundColor Gray
    $vaultDir = Read-Host "    VAULT_DIR (leave blank to fill in later)"
  }
  if (-not $vaultDir) { $vaultDir = "<SET-ME: path to your synced IdrisGV75 vault folder>" ; Warn "VAULT_DIR left blank - edit .env.local before first run" }
  $lines = @(
    "# Obsidian vault (sync this folder via OneDrive so the brain is shared).",
    "VAULT_DIR=$vaultDir",
    "",
    "# Semantic retrieval via local Ollama embeddings (keyless localhost).",
    "EMBED_BASE_URL=http://localhost:11434/v1",
    "EMBED_MODEL=nomic-embed-text",
    "",
    "# Desktop-only companions - uncomment on the machine that has them:",
    "# OPENCLAW_CMD=openclaw agent --agent main --message {input}",
    "# HERMES_BIN=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe",
    "# HERMES_CMD=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe -z {input}"
  )
  Set-Content -Path $envFile -Value $lines -Encoding UTF8
  Ok "wrote starter .env.local"
}

# ---- 9. auto-start at login (hidden) -------------------------------------
Section "Auto-start at login"
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'Mission Control Server.vbs'
$server = Join-Path $RepoDir 'server.cmd'
if ($DryRun) { Warn "would install hidden launcher -> $vbs" }
else {
  $l1 = 'Set sh = CreateObject("WScript.Shell")'
  $l2 = 'sh.Run """' + $server + '""", 0, False'
  Set-Content -Path $vbs -Value @($l1,$l2) -Encoding Ascii
  Ok "auto-start installed (runs hidden at every login)"
  if (Test-Path $server) { Info "starting Mission Control now..."; & wscript.exe $vbs }
}

# ---- done -----------------------------------------------------------------
Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "  Install complete." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host @"

Open:   http://127.0.0.1:3000   (give it ~30-60s the first time)

Still manual (can't be automated):
  * claude  ->  /login                (Claude sign-in)
  * OneDrive: sync the vault folder, and make sure VAULT_DIR in
    $envFile points at it ("Always keep on this device")
  * Studio API keys + WordPress: Settings -> API Keys / Publishing
  * Optional companions (desktop only): Hermes and OpenClaw have their
    own installers; then uncomment their lines in .env.local
  * Group role: Settings -> Machine Group & Roles (Primary vs Backup)

Update later:  update.cmd     Auto-start repair:  install-service.cmd
"@ -ForegroundColor Gray
