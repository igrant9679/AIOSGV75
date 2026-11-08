#!/bin/bash
# Mission Control updater for macOS: latest code (self-healing), rebuild, restart.
# Same as running install.sh and choosing "Update / repair", minus the questions.
cd "$(dirname "$0")" || exit 1
bash ./install.sh --mode install --yes --repo-dir "$(pwd)" "$@"
