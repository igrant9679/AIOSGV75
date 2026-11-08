@echo off
rem Mission Control installer / updater / modifier / uninstaller.
rem Double-click: installs, or (if already installed) offers Update, Modify,
rem Reinstall or Uninstall. Pass-through flags, e.g.:
rem   install.cmd -DryRun        install.cmd -Mode uninstall
rem Runs from %TEMP% so this window never holds the app folder open
rem (Reinstall/Uninstall move or delete it).
set "MC_PS1=%~dp0install.ps1"
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MC_PS1%" %*
pause
