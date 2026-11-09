@echo off
title Mission Control Setup
rem Bootstrap packed inside MissionControlSetup.exe. Fetches the installer from GitHub and
rem runs whichever copy is newer - GitHub's or the one bundled in this .exe - going by the
rem MC-INSTALLER-VERSION line. Offline, it uses the bundled copy.
set "MC_PS1=%TEMP%\mc-install-latest.ps1"
set "MC_WEB=%TEMP%\mc-install-web.ps1"
set "MC_BUNDLED=%~dp0install.ps1"
echo Getting the latest Mission Control installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pick-installer.ps1"
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MC_PS1%" %*
echo.
pause
