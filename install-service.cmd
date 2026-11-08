@echo off
setlocal
title Mission Control - Install Auto-Start

rem ---------------------------------------------------------------------------
rem  Sets Mission Control to start automatically at login and run HIDDEN, so it
rem  keeps running after you close any terminal. Re-run any time to repair or
rem  re-point the auto-start.
rem
rem  App folder is resolved in this order:
rem    1. the folder passed as an argument:  install-service.cmd "D:\my-clone"
rem    2. the folder this script lives in    (the normal case)
rem    3. whatever you type at the prompt    (if neither of the above contains
rem                                           server.cmd)
rem  Every machine can therefore keep the repo wherever it likes.
rem ---------------------------------------------------------------------------

set "REPO=%~1"
if not defined REPO set "REPO=%~dp0"
call :normalize

:check
if exist "%REPO%\server.cmd" goto install
echo.
echo server.cmd was not found in:
echo   %REPO%
echo.
echo Enter the full path to the mission-control folder on this machine
echo (the folder containing server.cmd and package.json).
echo Press Enter on an empty line to cancel.
echo.
set "REPO="
set /p "REPO=App folder: "
if not defined REPO goto cancelled
call :normalize
goto check

:install
echo Installing auto-start...
echo   app folder: %REPO%
echo.

rem One Scheduled Task ("Mission Control Watchdog") starts the server hidden at
rem login and restarts it within 5 minutes if it stops. It replaced the old
rem Startup-folder .vbs launcher, which Smart App Control blocks; installing
rem the task also removes that old launcher.
if not exist "%REPO%\watchdog.ps1" (
  echo ERROR: watchdog.ps1 is missing from %REPO% - run update.cmd first.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%\watchdog.ps1" -Install
if errorlevel 1 (
  echo ERROR: could not register the scheduled task - see the message above.
  pause
  exit /b 1
)

echo.
echo Auto-start installed. Starting now (hidden)...
powershell -NoProfile -Command "Start-ScheduledTask -TaskName 'Mission Control Watchdog'"
echo.
echo Done:
echo   - Starts automatically at every login.
echo   - Runs hidden, so closing a terminal will not stop it.
echo   - Open it at http://127.0.0.1:3000  (or the Mission Control shortcut).
echo   - Stop it any time with stop.cmd.
echo.
echo If a copy is already running in a terminal window, close that window and
echo either run this again or just reboot once for a clean hidden start.
echo.
pause
exit /b 0

:cancelled
echo Cancelled - nothing was changed.
pause
exit /b 1

rem Strip any quotes the user pasted, plus a trailing backslash, so the path we
rem pass to watchdog.ps1 is always a clean "<folder>" with no separator surprises.
:normalize
if defined REPO set REPO=%REPO:"=%
if not defined REPO goto :eof
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
goto :eof
