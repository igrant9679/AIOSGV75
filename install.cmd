@echo off
rem Double-click to install Mission Control (prereqs, app, services, auto-start).
rem Pass-through flags, e.g.:  install.cmd -DryRun    or    install.cmd -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
