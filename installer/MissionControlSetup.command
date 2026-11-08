#!/bin/bash
# Mission Control setup for macOS - double-click in Finder.
# (First time: right-click -> Open, then Open, because it was downloaded.)
# Gets the newest installer from GitHub and runs it: install, update, modify,
# reinstall or uninstall.
set -e
TMP="${TMPDIR:-/tmp}/mc-install-latest.sh"
echo "Getting the latest Mission Control installer..."
if ! curl -fsSL "https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.sh" -o "$TMP"; then
  HERE="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$HERE/install.sh" ]; then echo "Offline - using the install.sh next to this file."; cp "$HERE/install.sh" "$TMP"
  else echo "Couldn't download the installer - check your internet connection."; read -r -p "Press Return to close." _; exit 1; fi
fi
bash "$TMP" "$@"
echo
read -r -p "Press Return to close this window." _
