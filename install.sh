#!/bin/bash
# Mission Control - macOS installer, updater, modifier and uninstaller.
#
# Run it any time. Without Mission Control it installs everything; with it, it
# asks: 1 Update / repair, 2 Modify, 3 Reinstall, 4 Uninstall.
#
# Fresh Mac (the repo is public), in Terminal:
#   curl -fsSL https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.sh -o /tmp/mc-install.sh && bash /tmp/mc-install.sh
# Or double-click MissionControlSetup.command (right-click -> Open the first time).
#
# Full install covers: Homebrew, Git, Node.js 22.15+, Ollama (+ background
# service) and local models, the app (clone + build), Claude Code + Codex CLIs,
# the OneDrive vault, .env.local, the machine group (name + role), Hermes and
# OpenClaw (optional, official installers), Claude / Codex sign-in (browser),
# a LaunchAgent that starts Mission Control at login and restarts it if it
# stops, then it starts everything, runs the health check and opens the dashboard.
#
# Flags: --mode install|update|modify|reinstall|uninstall  --dry-run  --yes
#        --repo-dir <path>  --vault <path>  --label <name>  --role primary|backup|workstation
#        --components ollama,models,codex,hermes,openclaw   (or none) - skip the checklist
#        --skip-models  --skip-ollama  --install-ollama  --install-codex  --no-codex
#        --install-hermes  --install-openclaw  --no-hermes  --no-openclaw  --no-companions
#        --no-login  --no-start  --repair-only
#
# Never handles passwords: Homebrew asks for your Mac password itself, and
# sign-ins happen in the official CLIs' browser flow. Install / update /
# modify / reinstall never delete data/ or .env.local; uninstall offers a backup.
# Written for macOS's built-in bash 3.2.

MODE=""; REPO_DIR="$HOME/Documents/mission-control"; REPO_URL="https://github.com/igrant9679/AIOSGV75.git"; BRANCH="main"
VAULT=""; LABEL=""; ROLE=""; DRY=0; YES=0; SKIP_MODELS=0; SKIP_OLLAMA=0; INSTALL_CODEX=0; NO_CODEX=0
INSTALL_HERMES=0; INSTALL_OPENCLAW=0; NO_COMPANIONS=0; INSTALL_OLLAMA=0; NO_HERMES=0; NO_OPENCLAW=0; COMPONENTS=""; NO_LOGIN=0; NO_START=0; REPAIR_ONLY=0; REPO_DIR_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift ;;
    --repo-dir) REPO_DIR="$2"; REPO_DIR_SET=1; shift ;;
    --vault) VAULT="$2"; shift ;;
    --label) LABEL="$2"; shift ;;
    --role) ROLE="$2"; shift ;;
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --skip-models) SKIP_MODELS=1 ;;
    --skip-ollama) SKIP_OLLAMA=1 ;;
    --install-ollama) INSTALL_OLLAMA=1 ;;
    --components) COMPONENTS="$2"; shift ;;
    --no-hermes) NO_HERMES=1 ;;
    --no-openclaw) NO_OPENCLAW=1 ;;
    --install-codex) INSTALL_CODEX=1 ;;
    --no-codex) NO_CODEX=1 ;;
    --install-hermes) INSTALL_HERMES=1 ;;
    --install-openclaw) INSTALL_OPENCLAW=1 ;;
    --no-companions) NO_COMPANIONS=1 ;;
    --no-login) NO_LOGIN=1 ;;
    --no-start) NO_START=1 ;;
    --repair-only) REPAIR_ONLY=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done

STAMP=$(date +%Y%m%d-%H%M%S)
LOG="${TMPDIR:-/tmp}/mission-control-install-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
STEP=0; TODO=""; LATER=""
C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_GRAY=$'\033[90m'; C_OFF=$'\033[0m'
section() { STEP=$((STEP + 1)); printf "\n%s[%d] %s%s\n" "$C_CYAN" "$STEP" "$1" "$C_OFF"; }
ok()   { printf "    %sOK%s   %s\n" "$C_GREEN" "$C_OFF" "$1"; }
info() { printf "    %s..   %s%s\n" "$C_GRAY" "$1" "$C_OFF"; }
warn() { printf "    %s!!   %s%s\n" "$C_YEL" "$1" "$C_OFF"; }
todo() { warn "$1"; TODO="$TODO
  * $1"; }
later() { LATER="$LATER
  - $1"; }
have() { command -v "$1" >/dev/null 2>&1; }
ask() { # ask "question" default
  if [ $YES = 1 ] || [ $DRY = 1 ]; then echo "$2"; return; fi
  local a; read -r -p "    $1${2:+ [$2]} " a </dev/tty; [ -z "$a" ] && a="$2"; echo "$a"
}
yesno() { # yesno "question" y|n
  if [ $YES = 1 ] || [ $DRY = 1 ]; then [ "$2" = "y" ]; return; fi
  local hint="(y/N)"; [ "$2" = "y" ] && hint="(Y/n)"
  local a; read -r -p "    $1 $hint " a </dev/tty; [ -z "$a" ] && a="$2"
  case "$a" in [Yy]*) return 0 ;; *) return 1 ;; esac
}
refresh_path() {
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
    case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$d:$PATH" ;; esac
  done
  if have brew; then eval "$(brew shellenv)" 2>/dev/null; fi
  export PATH
}
node_ok() { have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=15)?0:1)'; }

# Already inside a clone?
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ $REPO_DIR_SET = 0 ] && [ -f "$HERE/package.json" ] && [ -d "$HERE/.git" ]; then REPO_DIR="$HERE"; fi
cd "${TMPDIR:-/tmp}" || true       # never hold the app folder open
refresh_path

ENV_FILE="$REPO_DIR/.env.local"; CLUSTER_FILE="$REPO_DIR/data/cluster.json"
AGENT_ID="ai.missioncontrol.server"; PLIST="$HOME/Library/LaunchAgents/$AGENT_ID.plist"; GUI="gui/$(id -u)"
HERMES_DOCS="https://hermes-agent.nousresearch.com/docs/getting-started/installation"; OPENCLAW_DOCS="https://docs.openclaw.ai/install"

env_get() { [ -f "$ENV_FILE" ] && grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" | head -1 | sed -E "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//; s/^\"//; s/\"$//"; }
ENV_BACKED=0
env_set() { # env_set KEY value
  [ $DRY = 1 ] && return; [ -f "$ENV_FILE" ] || return
  local cur; cur="$(env_get "$1")"; [ "$cur" = "$2" ] && return
  [ $ENV_BACKED = 0 ] && cp "$ENV_FILE" "$ENV_FILE.bak-$STAMP" && ENV_BACKED=1
  if grep -qE "^[[:space:]]*#?[[:space:]]*$1[[:space:]]*=" "$ENV_FILE"; then
    KEY="$1" VAL="$2" node -e 'const fs=require("fs"),f=process.argv[1],k=process.env.KEY;let done=false;const out=fs.readFileSync(f,"utf8").split("\n").map(l=>{if(!done&&new RegExp("^\\s*#?\\s*"+k+"\\s*=").test(l)){done=true;return k+"="+process.env.VAL}return l});fs.writeFileSync(f,out.join("\n"))' "$ENV_FILE"
  else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
  info "set $1 in .env.local"
}
cluster_get() { [ -f "$CLUSTER_FILE" ] && node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(c[process.argv[2]]??""))}catch{}' "$CLUSTER_FILE" "$1"; }
stop_mc() {
  launchctl bootout "$GUI/$AGENT_ID" >/dev/null 2>&1
  local pids; pids="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null)"; [ -n "$pids" ] && kill $pids 2>/dev/null
}
CURRENT_VAULT="$(env_get VAULT_DIR)"
VAULT_DIR="$VAULT"; [ -z "$VAULT_DIR" ] && [ -n "$CURRENT_VAULT" ] && [ -d "$CURRENT_VAULT/Agentic OS" ] && VAULT_DIR="$CURRENT_VAULT"

echo "=================================================="
echo "  Mission Control - macOS installer"
echo "  folder: $REPO_DIR"
echo "  log:    $LOG"
[ $DRY = 1 ] && echo "  DRY RUN - nothing will be installed or changed"
echo "=================================================="
[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }

# ---- mode ---------------------------------------------------------------------
[ "$MODE" = "update" ] && MODE="install"
if [ -z "$MODE" ]; then
  if [ ! -f "$REPO_DIR/package.json" ] || [ $YES = 1 ] || [ $DRY = 1 ]; then MODE="install"
  else
    echo; echo "Mission Control is already installed here$( [ -n "$(cluster_get label)" ] && echo " as '$(cluster_get label)' ($(cluster_get role))")."
    echo "  1  Update / repair   (latest code, fix problems, re-check everything)"
    echo "  2  Modify            (name/role, vault, Codex/Hermes/OpenClaw/models, sign-ins, auto-start)"
    echo "  3  Reinstall         (fresh copy of the app; keeps your settings and keys)"
    echo "  4  Uninstall"
    read -r -p "Choose 1-4 [1] " c </dev/tty
    case "$c" in 2) MODE=modify ;; 3) MODE=reinstall ;; 4) MODE=uninstall ;; *) MODE=install ;; esac
  fi
fi
echo; echo "Mode: $MODE"

SEL=""
if [ "$MODE" = "modify" ]; then
  echo; echo "What do you want to change? (comma-separated, e.g. 1,4)"
  echo "  1  Machine name / role in the machine group"
  echo "  2  Vault folder (VAULT_DIR)"
  echo "  3  Tools: Codex CLI, Ollama + local models"
  echo "  4  Companions: Hermes, OpenClaw"
  echo "  5  Sign-ins (Claude Code, Codex)"
  echo "  6  Auto-start at login (on/off)"
  echo "  7  Update the code too"
  if [ $YES = 1 ] || [ $DRY = 1 ]; then picks="1,2,3,4,5,6"; else read -r -p "Change: " picks </dev/tty; fi
  for p in $(echo "$picks" | tr ', ' '  '); do
    case "$p" in 1) SEL="$SEL group" ;; 2) SEL="$SEL vault" ;; 3) SEL="$SEL tools" ;; 4) SEL="$SEL companions" ;; 5) SEL="$SEL signin" ;; 6) SEL="$SEL autostart" ;; 7) SEL="$SEL app" ;; esac
  done
  [ -z "$SEL" ] && { echo "Nothing selected - no changes made."; exit 0; }
  case " $SEL " in *" vault "*) VAULT_DIR="$VAULT" ;; esac
fi
# Install / update / reinstall: choose the optional parts up front (one checklist),
# so the steps below don't ask about each one. Already-installed items are kept.
if { [ "$MODE" = "install" ] || [ "$MODE" = "reinstall" ]; } && [ $REPAIR_ONLY = 0 ]; then
  KEYS="ollama models codex hermes openclaw"
  hermes_here() { have hermes || [ -x "$HOME/.hermes/hermes-agent/venv/bin/hermes" ] || [ -x "$HOME/.local/bin/hermes" ]; }
  C_ollama=0; C_models=0; C_codex=0; C_hermes=0; C_openclaw=0
  H_ollama=0; H_codex=0; H_hermes=0; H_openclaw=0
  have ollama && { H_ollama=1; C_models=1; }
  have codex && H_codex=1
  hermes_here && H_hermes=1
  have openclaw && H_openclaw=1
  [ $INSTALL_OLLAMA = 1 ] && { C_ollama=1; C_models=1; }
  [ $SKIP_OLLAMA = 1 ] && { C_ollama=0; C_models=0; }
  [ $SKIP_MODELS = 1 ] && C_models=0
  [ $INSTALL_CODEX = 1 ] && C_codex=1
  [ $INSTALL_HERMES = 1 ] && C_hermes=1
  [ $INSTALL_OPENCLAW = 1 ] && C_openclaw=1
  label_of() { case "$1" in
    ollama) echo "Ollama - free local AI models + smarter vault search (~2.3 GB; best on the primary machine)" ;;
    models) echo "Local models for Ollama (llama3.2 + nomic-embed-text)" ;;
    codex) echo "Codex CLI - ChatGPT/Codex jobs on this machine (your ChatGPT subscription)" ;;
    hermes) echo "Hermes - goal mode + Control Room (~5-10 min)" ;;
    openclaw) echo "OpenClaw - Telegram gateway + approvals (primary machine only)" ;;
  esac; }
  getv() { eval "echo \$$1_$2"; }
  setv() { eval "$1_$2=$3"; }
  if [ -n "$COMPONENTS" ]; then
    for k in $KEYS; do setv C "$k" 0; done
    for c in $(echo "$COMPONENTS" | tr 'A-Z,' 'a-z '); do
      case " $KEYS none " in *" $c "*) [ "$c" != none ] && setv C "$c" 1 ;; *) warn "--components: unknown item '$c' (use ollama, models, codex, hermes, openclaw)" ;; esac
    done
  elif [ $YES = 0 ] && [ $DRY = 0 ]; then
    while :; do
      echo; echo "Choose what to install"
      echo "  Always installed: Homebrew, Git, Node.js, the Mission Control app, Claude Code CLI, auto-start"
      i=0
      for k in $KEYS; do
        i=$((i + 1))
        if [ "$k" != models ] && [ "$(getv H "$k")" = 1 ]; then echo "   [*] $i  $(label_of "$k")  (already installed - kept)"; continue; fi
        if [ "$(getv C "$k")" = 1 ]; then box="[x]"; else box="[ ]"; fi
        echo "   $box $i  $(label_of "$k")"
      done
      read -r -p "Type numbers to turn items on/off (e.g. 1 3), or press Enter to continue: " t </dev/tty
      [ -z "$t" ] && break
      for n in $(echo "$t" | tr ',' ' '); do
        i=0
        for k in $KEYS; do
          i=$((i + 1)); [ "$i" = "$n" ] || continue
          [ "$k" != models ] && [ "$(getv H "$k")" = 1 ] && continue
          if [ "$(getv C "$k")" = 1 ]; then setv C "$k" 0; else setv C "$k" 1; [ "$k" = ollama ] && C_models=1; fi
        done
      done
    done
  fi
  # apply: the steps below read these flags and stop asking
  if [ $C_ollama = 1 ] || [ $H_ollama = 1 ]; then SKIP_OLLAMA=0; else SKIP_OLLAMA=1; fi; INSTALL_OLLAMA=$C_ollama
  [ $C_models = 1 ] && SKIP_MODELS=0 || SKIP_MODELS=1
  if [ $C_codex = 1 ] || [ $H_codex = 1 ]; then NO_CODEX=0; else NO_CODEX=1; fi; INSTALL_CODEX=$C_codex
  NO_HERMES=$((1 - C_hermes)); INSTALL_HERMES=$C_hermes
  NO_OPENCLAW=$((1 - C_openclaw)); INSTALL_OPENCLAW=$C_openclaw
  PICKED=""; for k in $KEYS; do { [ "$k" = models ] || [ "$(getv H "$k")" = 0 ]; } && [ "$(getv C "$k")" = 1 ] && PICKED="$PICKED $k"; done
  info "optional items:${PICKED:- none} (re-run the installer -> Modify to add more later)"
fi

should() { [ $REPAIR_ONLY = 1 ] && { [ "$1" = "app" ]; return; }; [ "$MODE" != "modify" ] && return 0; [ "$1" = "start" ] && return 0; case " $SEL " in *" $1 "*) return 0 ;; esac; return 1; }

# ---- uninstall ------------------------------------------------------------------
if [ "$MODE" = "uninstall" ]; then
  section "Uninstall Mission Control"
  if [ ! -d "$REPO_DIR" ]; then warn "nothing installed at $REPO_DIR"; exit 0; fi
  echo "    This stops Mission Control, removes its LaunchAgent, and deletes $REPO_DIR."
  echo "    Your vault, Claude Code, Git, Node and Homebrew stay. You'll be offered a backup of your settings first."
  if [ $YES = 0 ] && [ $DRY = 0 ]; then read -r -p "    Type UNINSTALL to continue: " c </dev/tty; [ "$c" = "UNINSTALL" ] || { warn "cancelled - nothing changed"; exit 0; }; fi
  if [ $DRY = 1 ]; then warn "would stop it, remove the LaunchAgent, offer to leave the group, back up data/ + .env.local, and delete $REPO_DIR"; exit 0; fi
  stop_mc; rm -f "$PLIST"; ok "removed start-at-login"
  HOSTN="$(node -p 'require("os").hostname()' 2>/dev/null || hostname)"; NAME="$(cluster_get label)"; [ -z "$NAME" ] && NAME="$HOSTN"
  if [ "$(cluster_get enabled)" = "true" ] && [ -n "$VAULT_DIR" ] && yesno "Remove this machine from the machine group (Fleet, Health)?" y; then
    for sub in nodes health sessions; do rm -f "$VAULT_DIR/Agentic OS/Cluster/$sub/$HOSTN.json"; done; ok "left the machine group"
    if yesno "Also delete this machine's shared conversations and tool-memory copies from the vault?" n; then
      rm -rf "$VAULT_DIR/Agentic OS/Sessions/$NAME" "$VAULT_DIR/Agentic OS/Tool Memory/$NAME"; ok "deleted them"
    fi
  fi
  BK="$(dirname "$REPO_DIR")/mission-control-backup-$STAMP"
  if yesno "Keep a backup of your settings and API keys (data/ and .env.local) in $BK ?" y; then
    mkdir -p "$BK"; [ -d "$REPO_DIR/data" ] && cp -R "$REPO_DIR/data" "$BK/"; [ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$BK/"
    ok "backup saved to $BK (it contains API keys - keep it private)"
  fi
  rm -rf "$REPO_DIR" && ok "deleted $REPO_DIR"
  have codex && yesno "Also uninstall the Codex CLI?" n && npm uninstall -g @openai/codex && ok "Codex removed"
  have ollama && yesno "Also uninstall Ollama and its models?" n && { brew services stop ollama >/dev/null 2>&1; brew uninstall ollama && ok "Ollama removed"; }
  have openclaw && later "OpenClaw is still installed - see $OPENCLAW_DOCS to remove it (openclaw gateway stop first)"
  have hermes && later "Hermes is still installed - see $HERMES_DOCS to remove it"
  later "Left in place on purpose: your vault, Claude Code, Git, Node.js and Homebrew."
  echo; echo "Uninstall finished.$TODO$LATER"; echo "Log: $LOG"; exit 0
fi

if [ "$MODE" = "reinstall" ] && [ -d "$REPO_DIR" ]; then
  OLD="$REPO_DIR.old-$STAMP"
  if [ $DRY = 1 ]; then warn "would move $REPO_DIR to $OLD and install a fresh copy (keeping data/ and .env.local)"
  else stop_mc; mv "$REPO_DIR" "$OLD" && info "moved the old install to $OLD"; fi
fi

# ---- 1-3. Homebrew, Git, Node ----------------------------------------------------
if should prereqs; then
  section "Homebrew"
  if have brew; then ok "brew present"
  elif [ $DRY = 1 ]; then warn "would install Homebrew (it asks for your Mac password)"
  else
    info "installing Homebrew - it asks for your Mac password and may install Apple's command line tools..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
    refresh_path; have brew && ok "Homebrew installed" || { echo "${C_RED}Homebrew didn't install - see https://brew.sh and run this again.${C_OFF}"; exit 1; }
  fi
  section "Git"
  if have git && git --version >/dev/null 2>&1; then ok "$(git --version)"; elif [ $DRY = 1 ]; then warn "would brew install git"; else brew install git && ok "Git installed"; fi
  section "Node.js (22.15 or newer)"
  if node_ok; then ok "Node $(node -v)"
  elif [ $DRY = 1 ]; then warn "would brew install node"
  else brew install node || brew upgrade node; refresh_path; node_ok && ok "Node $(node -v)" || todo "Node.js 22.15+ isn't available - run 'brew install node' and run this again"; fi
fi

USE_OLLAMA=1; [ $SKIP_OLLAMA = 1 ] && USE_OLLAMA=0
if should tools; then
  section "Ollama (free local models + vault search embeddings)"
  if [ $SKIP_OLLAMA = 1 ]; then info "skipped"
  elif have ollama; then ok "ollama present"
  elif [ $INSTALL_OLLAMA = 1 ] || yesno "Install Ollama? Recommended - powers semantic vault search and free local models." y; then
    if [ $DRY = 1 ]; then warn "would brew install ollama"; else brew install ollama && ok "Ollama installed"; fi
  else USE_OLLAMA=0; info "skipped"; fi
  if have ollama && [ $USE_OLLAMA = 1 ]; then
    if [ $DRY = 1 ]; then warn "would run Ollama as a background service (brew services start ollama)"
    else brew services start ollama >/dev/null 2>&1 && ok "Ollama runs in the background and starts at login"; sleep 2; fi
  fi
fi

# ---- 5-6. The app ----------------------------------------------------------------
move_blockers() { # move untracked files that block a checkout/pull into a backup folder
  echo "$1" | grep -q "untracked working tree files would be overwritten" || return 1
  local bk; bk="$(dirname "$REPO_DIR")/mc-untracked-backup-$STAMP"; local n=0
  while IFS= read -r f; do
    f="$(echo "$f" | sed -E 's/^[[:space:]]+//')"; [ -z "$f" ] && continue
    if [ -e "$REPO_DIR/$f" ]; then mkdir -p "$bk/$(dirname "$f")"; mv "$REPO_DIR/$f" "$bk/$f"; n=$((n + 1)); fi
  done <<EOF
$(echo "$1" | grep -E '^[[:space:]]+[^[:space:]]' | grep -vE 'Please|Aborting')
EOF
  [ $n -gt 0 ] && warn "moved $n hand-copied file(s) to $bk (the official versions replace them)"
  [ $n -gt 0 ]
}
if should app; then
  section "Mission Control app"
  if [ ! -d "$REPO_DIR/.git" ] && [ -d "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
    OLD="$REPO_DIR.old-$STAMP"
    if [ $DRY = 1 ]; then warn "folder isn't a git clone - would move it to $OLD and clone fresh (keeping data/ and .env.local)"
    else warn "folder isn't a git clone - moving it to $OLD and cloning fresh"; mv "$REPO_DIR" "$OLD"; fi
  fi
  if [ ! -d "$REPO_DIR/.git" ]; then
    if [ $DRY = 1 ]; then warn "would clone $REPO_URL -> $REPO_DIR"
    else
      git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR" || { echo "${C_RED}git clone failed - check the internet connection and run again.${C_OFF}"; exit 1; }
      if [ -n "$OLD" ] && [ -d "$OLD" ]; then
        [ -d "$OLD/data" ] && cp -R "$OLD/data" "$REPO_DIR/" && info "carried over data/"
        [ -f "$OLD/.env.local" ] && cp "$OLD/.env.local" "$REPO_DIR/" && info "carried over .env.local"
      fi
      ok "cloned into $REPO_DIR"
    fi
  else
    ok "clone exists at $REPO_DIR"
    if [ $DRY = 0 ]; then
      cd "$REPO_DIR" || exit 1
      git remote get-url origin >/dev/null 2>&1 || { git remote add origin "$REPO_URL"; info "added the GitHub remote"; }
      git fetch origin >/dev/null 2>&1 || warn "git fetch failed"
      CUR="$(git branch --show-current)"
      if [ "$CUR" != "$BRANCH" ]; then
        if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then ARGS="checkout $BRANCH"; else ARGS="checkout -b $BRANCH origin/$BRANCH"; fi
        OUT="$(git $ARGS 2>&1)" || { move_blockers "$OUT" && OUT="$(git $ARGS 2>&1)"; }
        [ "$(git branch --show-current)" = "$BRANCH" ] && info "switched from '$CUR' to '$BRANCH'" || todo "couldn't switch to '$BRANCH': $OUT"
      fi
      git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1
      OUT="$(git pull --ff-only 2>&1)"; RC=$?
      if [ $RC -ne 0 ] && move_blockers "$OUT"; then OUT="$(git pull --ff-only 2>&1)"; RC=$?; fi
      [ $RC -eq 0 ] && ok "code is up to date ($(git log -1 --format='%h %s'))" || todo "git pull failed - run 'git status' in $REPO_DIR: $OUT"
      cd "${TMPDIR:-/tmp}"
    fi
  fi
  if [ $REPAIR_ONLY = 1 ]; then echo; echo "--repair-only: code repaired/updated; nothing else changed.$TODO"; [ -z "$TODO" ]; exit $?; fi

  section "Dependencies + build"
  if [ $DRY = 1 ]; then warn "would stop Mission Control, run npm install + npm run build"
  elif [ -f "$REPO_DIR/package.json" ]; then
    stop_mc; cd "$REPO_DIR"
    info "npm install (a few minutes the first time)..."
    if npm install --no-audit --no-fund; then info "npm run build..."; npm run build && ok "app built" || todo "build failed - see $LOG"; else todo "npm install failed - see $LOG"; fi
    cd "${TMPDIR:-/tmp}"
  fi
fi

if should tools; then
  section "Local models (llama3.2 + nomic-embed-text)"
  if [ $SKIP_MODELS = 1 ] || [ $USE_OLLAMA = 0 ] || ! have ollama; then info "skipped"
  else
    for m in llama3.2 nomic-embed-text; do
      if ollama list 2>/dev/null | grep -q "^$m"; then ok "$m already pulled"
      elif [ $DRY = 1 ]; then warn "would pull $m"
      else ollama pull "$m" && ok "pulled $m" || todo "couldn't pull $m - run 'ollama pull $m' later"; fi
    done
  fi
fi

if should prereqs; then
  section "Claude Code CLI (required)"
  if have claude; then ok "claude present"
  elif [ $DRY = 1 ]; then warn "would install Claude Code (curl -fsSL https://claude.ai/install.sh | bash)"
  else curl -fsSL https://claude.ai/install.sh | bash; refresh_path; have claude && ok "Claude Code installed" || todo "Claude Code didn't install - see https://claude.com/claude-code"; fi
fi
if should tools; then
  section "Codex CLI (optional - uses your ChatGPT subscription)"
  if have codex; then ok "codex present"
  elif [ $NO_CODEX = 1 ]; then info "skipped"
  elif [ $INSTALL_CODEX = 1 ] || yesno "Install the Codex CLI?" n; then
    if [ $DRY = 1 ]; then warn "would npm install -g @openai/codex"; else npm install -g @openai/codex && ok "Codex installed" || todo "run 'npm install -g @openai/codex' later"; fi
  else info "skipped"; fi
fi

# ---- vault + .env.local ------------------------------------------------------------
if should vault; then
  section "Obsidian vault (the shared brain)"
  if [ -n "$VAULT_DIR" ] && [ "$MODE" != "modify" ]; then ok "vault: $VAULT_DIR"
  else
    info "looking for the synced vault (a folder containing 'Agentic OS')..."
    CANDS="$(for r in "$HOME/Library/CloudStorage" "$HOME/OneDrive"* "$HOME/Documents" "$HOME/Desktop"; do [ -d "$r" ] && find "$r" -maxdepth 7 -type d -name "Agentic OS" 2>/dev/null; done | sed 's|/Agentic OS$||' | awk '{ print (index($0,"IdrisGV75")?0:1) "\t" $0 }' | sort | cut -f2 | uniq)"
    if [ -n "$CANDS" ]; then
      i=0; echo "$CANDS" | head -6 | while IFS= read -r v; do i=$((i + 1)); info "  [$i] $v"; done
      pick="$(ask "Use which vault? (number, or paste a path)" 1)"
      case "$pick" in [0-9]*) VAULT_DIR="$(echo "$CANDS" | sed -n "${pick}p")" ;; *) VAULT_DIR="$pick" ;; esac
    else
      warn "no vault found. In the OneDrive app, sync the 'AI Mission Control/IdrisGV75' folder (LSI Media LLC library) first."
      VAULT_DIR="$(ask "Paste the vault path now, or press Enter to set it later" "")"
    fi
  fi
  if [ -n "$VAULT_DIR" ] && [ ! -d "$VAULT_DIR/Agentic OS" ]; then warn "'$VAULT_DIR' has no 'Agentic OS' folder - that's not the vault"; VAULT_DIR=""; fi
  if [ -n "$VAULT_DIR" ]; then ok "vault: $VAULT_DIR"; later "In Finder, right-click the vault folder -> 'Always Keep on This Device' so the brain works offline"
  else todo "Set VAULT_DIR in $ENV_FILE to the synced vault (the folder containing 'Agentic OS'), then run this installer again"; fi

  section "Machine config (.env.local)"
  if [ $DRY = 1 ]; then warn "would write/update $ENV_FILE"
  elif [ -f "$ENV_FILE" ]; then [ -n "$VAULT_DIR" ] && env_set VAULT_DIR "$VAULT_DIR"; ok ".env.local present"
  elif [ -d "$REPO_DIR" ]; then
    E1="EMBED_BASE_URL=http://localhost:11434/v1"; E2="EMBED_MODEL=nomic-embed-text"; [ $USE_OLLAMA = 0 ] && E1="# $E1" && E2="# $E2"
    cat > "$ENV_FILE" <<EOF
# Obsidian vault - the OneDrive-synced folder that contains 'Agentic OS'.
VAULT_DIR=${VAULT_DIR:-<SET-ME: the synced vault folder that contains 'Agentic OS'>}

# Semantic vault search via local Ollama embeddings (keyless, localhost).
$E1
$E2

# Telegram: only the master machine needs these (see the Guide).
# TELEGRAM_BOT_TOKEN=

# Companion agents - set by the installer when they're installed:
# OPENCLAW_CMD=openclaw agent --agent main --message {input}
# HERMES_BIN=
# HERMES_CMD=
EOF
    ok "wrote .env.local"
  fi
fi

# ---- machine group ------------------------------------------------------------------
if should group; then
  section "Machine group (shares sessions, health and jobs through the vault)"
  if [ "$(cluster_get enabled)" = "true" ] && [ -z "$LABEL$ROLE" ] && [ "$MODE" != "modify" ]; then ok "already in the group as '$(cluster_get label)' ($(cluster_get role))"
  elif [ -z "$VAULT_DIR" ]; then todo "Join the machine group later (Settings -> Machine Group & Roles) once the vault is set"
  elif yesno "Join the machine group?" y; then
    PRIMARY="$(for f in "$VAULT_DIR/Agentic OS/Cluster/nodes/"*.json; do [ -f "$f" ] && node -e 'const n=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(n.role==="primary")console.log(n.label)' "$f" 2>/dev/null; done | head -1)"
    DEF_LABEL="${LABEL:-$(cluster_get label)}"; [ -z "$DEF_LABEL" ] && DEF_LABEL="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
    NAME="$(ask "Display name for this machine" "$DEF_LABEL")"
    [ -n "$PRIMARY" ] && info "the group's primary is $PRIMARY"
    info "roles: workstation = shares + works, never runs scheduled jobs (recommended)"
    info "       backup      = also takes over jobs while the primary is down"
    info "       primary     = runs the scheduled jobs (only ONE machine)"
    DEF_ROLE="${ROLE:-$(cluster_get role)}"; [ -z "$DEF_ROLE" ] && DEF_ROLE="workstation"
    R="$(ask "Role (workstation / backup / primary)" "$DEF_ROLE" | tr 'A-Z' 'a-z')"
    case "$R" in workstation|backup|primary) ;; *) R=workstation ;; esac
    if [ "$R" = "primary" ] && [ -n "$PRIMARY" ]; then warn "$PRIMARY is already primary - two primaries fight over the jobs"; yesno "Make this machine primary anyway?" n || R=backup; fi
    if [ $DRY = 1 ]; then warn "would write data/cluster.json: $NAME / $R"
    else
      mkdir -p "$REPO_DIR/data"
      NAME="$NAME" R="$R" DIR="$REPO_DIR" node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({enabled:true,role:process.env.R,installDir:process.env.DIR,label:process.env.NAME},null,2))' "$CLUSTER_FILE"
      ok "joined the machine group as '$NAME' ($R)"
    fi
  else info "skipped - this machine runs on its own"; fi
fi

# ---- companions -------------------------------------------------------------------------
if should companions; then
  section "Companions (start automatically with Mission Control)"
  find_hermes() { have hermes && command -v hermes && return; for p in "$HOME/.hermes/hermes-agent/venv/bin/hermes" "$HOME/.local/bin/hermes"; do [ -x "$p" ] && echo "$p" && return; done; }
  HB="$(find_hermes)"
  if [ -z "$HB" ] && [ $NO_COMPANIONS = 0 ] && [ $NO_HERMES = 0 ]; then
    info "Hermes (Nous Research agent: goal mode + Control Room) - optional. Docs: $HERMES_DOCS"
    if [ $INSTALL_HERMES = 1 ] || yesno "Install Hermes now with its official installer? (~5-10 min)" n; then
      if [ $DRY = 1 ]; then warn "would run: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
      else curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash; refresh_path; HB="$(find_hermes)"; [ -z "$HB" ] && todo "Hermes didn't finish installing - see $HERMES_DOCS, then run this installer again (Modify)"; fi
    else later "Hermes (optional): curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash   then run this installer again -> Modify.  Docs: $HERMES_DOCS"; fi
  fi
  if [ -n "$HB" ]; then env_set HERMES_BIN "$HB"; env_set HERMES_CMD "$HB -z {input}"; ok "Hermes wired up - Mission Control starts its dashboard automatically"; fi
  MYROLE="$(cluster_get role)"
  if have openclaw; then
    env_set OPENCLAW_CMD "openclaw agent --agent main --message {input}"; ok "OpenClaw present"
    [ "$MYROLE" != "primary" ] && [ -f "$CLUSTER_FILE" ] && warn "this isn't the primary machine - keep the OpenClaw Telegram gateway OFF here (openclaw gateway stop)"
  elif { [ "$MYROLE" = "primary" ] || [ ! -f "$CLUSTER_FILE" ] || [ $INSTALL_OPENCLAW = 1 ]; } && [ $NO_COMPANIONS = 0 ] && [ $NO_OPENCLAW = 0 ]; then
    info "OpenClaw (Telegram gateway + approvals from your phone) - optional, primary machine only. Docs: $OPENCLAW_DOCS"
    if [ $INSTALL_OPENCLAW = 1 ] || yesno "Install OpenClaw now with its official installer? (it opens a setup wizard)" n; then
      if [ $DRY = 1 ]; then warn "would run: curl -fsSL https://openclaw.ai/install.sh | bash   then: openclaw onboard --install-daemon"
      else
        curl -fsSL https://openclaw.ai/install.sh | bash; refresh_path
        if have openclaw; then env_set OPENCLAW_CMD "openclaw agent --agent main --message {input}"; ok "OpenClaw installed"
          later "OpenClaw: if its gateway isn't running yet, run   openclaw onboard --install-daemon   (starts it automatically), then pair your Telegram bot. Docs: $OPENCLAW_DOCS"
        else todo "OpenClaw didn't finish installing - see $OPENCLAW_DOCS"; fi
      fi
    else later "OpenClaw (optional, primary only): curl -fsSL https://openclaw.ai/install.sh | bash   then   openclaw onboard --install-daemon.  Docs: $OPENCLAW_DOCS"; fi
  else info "OpenClaw: not on this machine (only the primary runs the Telegram gateway)"; fi
fi

# ---- sign-ins -------------------------------------------------------------------------------
if should signin; then
  section "Sign in (Claude Code + Codex) - opens your browser"
  claude_in() { have claude && claude auth status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s.slice(s.indexOf("{"))).loggedIn?0:1)}catch{process.exit(1)}})'; }
  if ! have claude; then info "claude not installed - skipped"
  elif claude_in; then ok "Claude Code: signed in"
  elif [ $NO_LOGIN = 1 ] || [ $YES = 1 ] || [ $DRY = 1 ]; then todo "Sign in to Claude Code: run 'claude auth login'"
  elif yesno "Claude Code is signed out. Sign in now?" y; then claude auth login </dev/tty; claude_in && ok "Claude Code signed in" || todo "run 'claude auth login' later"
  else todo "Sign in to Claude Code: run 'claude auth login'"; fi
  if have codex; then
    if codex login status 2>&1 | grep -q "Logged in"; then ok "Codex: signed in"
    elif [ $NO_LOGIN = 1 ] || [ $YES = 1 ] || [ $DRY = 1 ]; then todo "Sign in to Codex: run 'codex login'"
    elif yesno "Codex is signed out. Sign in now?" y; then codex login </dev/tty; codex login status 2>&1 | grep -q "Logged in" && ok "Codex signed in" || todo "run 'codex login' later"
    else todo "Sign in to Codex: run 'codex login'"; fi
  fi
fi

# ---- auto-start (LaunchAgent: starts at login, restarts if it stops) ---------------------------
if should autostart; then
  section "Start at login (LaunchAgent - also restarts it if it stops)"
  WANT=1; [ "$MODE" = "modify" ] && { yesno "Start Mission Control automatically at login?" y || WANT=0; }
  if [ $WANT = 0 ]; then
    [ $DRY = 1 ] && warn "would remove the LaunchAgent" || { launchctl bootout "$GUI/$AGENT_ID" >/dev/null 2>&1; rm -f "$PLIST"; ok "auto-start turned off - start it with: cd \"$REPO_DIR\" && npm start"; }
  elif [ $DRY = 1 ]; then warn "would install $PLIST"
  else
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/MissionControl"
    NPM="$(command -v npm)"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array><string>$NPM</string><string>start</string><string>--</string><string>-H</string><string>127.0.0.1</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/MissionControl/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/MissionControl/server.log</string>
</dict>
</plist>
EOF
    ok "starts at login and restarts if it stops (logs: ~/Library/Logs/MissionControl/server.log)"
  fi
fi

# ---- start + verify ----------------------------------------------------------------------------------
section "Start + health check"
if [ $DRY = 1 ] || [ $NO_START = 1 ]; then info "skipped"
elif [ -f "$REPO_DIR/package.json" ]; then
  [ "$MODE" = "modify" ] && { info "restarting so the changes apply..."; stop_mc; sleep 2; }
  if ! lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    if [ -f "$PLIST" ]; then launchctl bootout "$GUI/$AGENT_ID" >/dev/null 2>&1; launchctl bootstrap "$GUI" "$PLIST"
    else (cd "$REPO_DIR" && nohup npm start -- -H 127.0.0.1 >"$HOME/Library/Logs/mission-control.log" 2>&1 &); fi
  fi
  info "waiting for http://127.0.0.1:3000 ..."
  UP=0; for i in $(seq 1 60); do curl -fs -o /dev/null -m 5 http://127.0.0.1:3000/ && UP=1 && break; sleep 3; done
  if [ $UP = 0 ]; then todo "Mission Control didn't answer on port 3000 - see ~/Library/Logs/MissionControl/server.log"
  else
    ok "Mission Control is running"
    curl -fs -m 90 -X POST -H 'Content-Type: application/json' -d '{"action":"run"}' http://127.0.0.1:3000/api/health | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);for(const c of j.report.checks){const t=(c.label.padEnd(34)+" "+c.detail).slice(0,140);const tag={ok:"\x1b[32mOK\x1b[0m  ",warn:"\x1b[33m!!\x1b[0m  ",fail:"\x1b[31mXX\x1b[0m  "}[c.level]||"--  ";console.log("    "+tag+" "+t)}}catch{console.log("    !!   could not read the health report")}})'
    open "http://127.0.0.1:3000/command"
  fi
fi

echo; echo "=================================================="
if [ $DRY = 1 ]; then echo "  Dry run finished - nothing was changed."
elif [ -z "$TODO" ]; then echo "  All done - Mission Control is running."
else echo "  Done, with things left for you:$TODO"; fi
echo "=================================================="
[ -n "$LATER" ] && echo "  Optional next steps:$LATER"
echo
echo "  Dashboard:  http://127.0.0.1:3000/command   (Guide -> \"Install, update & uninstall\")"
echo "  Run again:  bash \"$REPO_DIR/install.sh\" to update, modify, reinstall or uninstall"
echo "  Log:        $LOG"
[ "$MODE" = "reinstall" ] && [ -n "$OLD" ] && [ -d "$OLD" ] && echo "  The previous install is in $OLD - delete it once everything works."
exit 0
