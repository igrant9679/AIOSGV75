@echo off
title Agentic Operations Control - start a NEW network (first machine)
rem First machine of a new network: installs Agentic Operations Control, creates a new
rem OneDrive vault, makes this PC the network's primary and asks for its names and Telegram bot.
rem Runs the newer of GitHub's installer and the install.ps1 next to this file.
set "MC_PS1=%TEMP%\mc-install-latest.ps1"
set "MC_WEB=%TEMP%\mc-install-web.ps1"
set "MC_BUNDLED=%~dp0install.ps1"
echo Getting the latest installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pick-installer.ps1"
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MC_PS1%" -ProductName "Agentic Operations Control" -NewNetwork %*
echo.
pause
