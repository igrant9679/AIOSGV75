#!/bin/bash
# Mission Control self-update for macOS (Fleet -> Versions -> Update).
# Started detached by the running server (lib/selfUpdate.ts). It runs update.sh, which pulls,
# builds and restarts Mission Control the way the installer does, and reports to
# data/update-status.json for the server that comes back. Output: data/update.log.
# (The Windows script, self-update.ps1, also rolls back a failed build; this one does not.)
cd "$(dirname "$0")/.." || exit 1
JOB="${1:-}"
BY="${2:-}"
STATUS=data/update-status.json
mkdir -p data
now() { echo $(( $(date +%s) * 1000 )); }
STARTED=$(now)
STEPS=""
step() { STEPS="${STEPS:+$STEPS,}\"$(date +%H:%M:%S) $1\""; }
write() { # state step note upToDate
  printf '{"jobId":"%s","by":"%s","state":"%s","step":"%s","steps":[%s],"oldHead":"%s","newHead":"%s","note":"%s","upToDate":%s,"startedAt":%s,"at":%s}\n' \
    "$JOB" "$BY" "$1" "$2" "$STEPS" "$OLD" "$NEW" "$3" "${4:-false}" "$STARTED" "$(now)" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
}
OLD=$(git rev-parse HEAD 2>/dev/null)
NEW=$OLD
BUILT=$(sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' .next/mc-build.json 2>/dev/null | head -1)
echo "===== $(date '+%Y-%m-%d %H:%M:%S') update asked by $BY (job $JOB) =====" >> data/update.log

step "Getting the new code"; write running pull ""
git fetch --quiet origin >> data/update.log 2>&1
BRANCH=$(git branch --show-current)
if [ "$(git rev-parse "origin/$BRANCH" 2>/dev/null)" = "$OLD" ] && [ "$BUILT" = "$OLD" ]; then
  step "Already up to date"; write done finished "Already up to date (${OLD:0:7})." true
  exit 0
fi

step "Updating, building and restarting (update.sh)"; write running build ""
bash ./update.sh >> data/update.log 2>&1
CODE=$?
NEW=$(git rev-parse HEAD 2>/dev/null)
if [ $CODE -eq 0 ]; then
  step "Updated ${OLD:0:7} -> ${NEW:0:7}"; write done finished "Updated ${OLD:0:7} -> ${NEW:0:7}"
else
  step "update.sh failed (exit $CODE)"; write failed finished "update.sh failed (exit $CODE). See data/update.log on this Mac."
fi
