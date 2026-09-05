@echo off
setlocal
title Mission Control - Install Watchdog

rem ---------------------------------------------------------------------------
rem  Registers the "Mission Control Watchdog" Scheduled Task: every 5 minutes,
rem  if nothing is listening on 127.0.0.1:3000, relaunch server.cmd hidden.
rem  Companion to install-service.cmd (which only starts the server at LOGIN).
rem  Re-run any time to repair. Remove with:  install-watchdog.cmd uninstall
rem  Details, guards and the pause switch: see the header of watchdog.ps1.
rem ---------------------------------------------------------------------------

if /i "%~1"=="uninstall" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1" -Uninstall
) else if /i "%~1"=="status" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1" -Status
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1" -Install
)
echo.
pause
