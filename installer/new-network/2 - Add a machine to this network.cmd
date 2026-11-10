@echo off
title Agentic Operations Control - add this machine to a network
rem Every other machine: installs Agentic Operations Control and joins an existing network
rem by using its vault (sync the vault folder with OneDrive first). Also updates / modifies /
rem uninstalls on a machine that already has it.
rem Runs the newer of GitHub's installer and the install.ps1 next to this file.
set "MC_PS1=%TEMP%\mc-install-latest.ps1"
set "MC_WEB=%TEMP%\mc-install-web.ps1"
set "MC_BUNDLED=%~dp0install.ps1"
echo Getting the latest installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pick-installer.ps1"
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MC_PS1%" -ProductName "Agentic Operations Control" %*
echo.
pause
