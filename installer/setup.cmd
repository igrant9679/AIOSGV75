@echo off
title Mission Control Setup
rem Bootstrap packed inside MissionControlSetup.exe. Gets the newest installer
rem from GitHub (so an old .exe still installs the latest version); falls back
rem to the copy bundled in the .exe when offline.
set "MC_PS1=%TEMP%\mc-install-latest.ps1"
echo Getting the latest Mission Control installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1' -OutFile $env:MC_PS1; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Offline - using the installer bundled in this setup.
  copy /y "%~dp0install.ps1" "%MC_PS1%" >nul
)
cd /d "%TEMP%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%MC_PS1%" %*
echo.
pause
