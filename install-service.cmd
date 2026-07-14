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
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\Mission Control Server.vbs"

echo Installing auto-start...
echo   app folder: %REPO%
echo   launcher:   %VBS%
echo.

rem Write a tiny launcher that runs server.cmd with window style 0 (hidden) and
rem does not wait. That hidden, detached launch is why it survives closing any
rem window; putting it in the Startup folder is why it runs at every login.
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.Run """%REPO%\server.cmd""", 0, False

if not exist "%VBS%" (
  echo ERROR: could not write the startup launcher - check permissions.
  pause
  exit /b 1
)

echo Auto-start installed. Launching now (hidden)...
wscript.exe "%VBS%"

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
rem bake into the VBS is always a clean "<folder>" with no separator surprises.
:normalize
if defined REPO set REPO=%REPO:"=%
if not defined REPO goto :eof
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
goto :eof
