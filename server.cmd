@echo off
title Mission Control Server
cd /d "%~dp0"

rem Don't double-start if something already owns port 3000.
rem /C: is REQUIRED: without it findstr splits the pattern on the space and
rem treats it as an OR-list, so ":3000 " also matches an IPv6 address that
rem merely CONTAINS the hextet 3000 (e.g. [fddb:ee5:df6d:1:982f:3000:a178:2e66]
rem listening on some unrelated port). That made this guard fire against a
rem stranger's socket and the server silently refused to start — no output,
rem because the exit is `exit /b`. Windows IPv6 privacy addresses rotate, so it
rem struck intermittently and looked like "Mission Control just didn't come up".
netstat -ano | findstr /C:":3000 " | findstr /C:"LISTENING" >nul
if %errorlevel%==0 exit /b

rem Agent CLIs the server spawns must be resolvable no matter what PATH this
rem process inherited (a boot-time PATH once missed the Claude native install
rem and the bridge showed offline). Prepend the known install dirs.
set "PATH=%USERPROFILE%\.local\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\Ollama;%PATH%"

rem -H 127.0.0.1: never expose the dashboard (which can run commands) to the LAN
rem --log (the watchdog starts it this way, hidden): keep everything it prints in
rem data\server.log, so a crash leaves its reason behind. Over 5 MB, the old log
rem becomes server.log.1. Double-clicked (no --log), the output stays on screen.
if /i not "%~1"=="--log" (
  npm start -- -H 127.0.0.1
  exit /b
)
if not exist "data" mkdir "data"
if exist "data\server.log" for %%F in ("data\server.log") do if %%~zF GTR 5242880 move /y "data\server.log" "data\server.log.1" >nul
echo.>> "data\server.log"
echo ===== %date% %time% server.cmd: starting =====>> "data\server.log"
call npm start -- -H 127.0.0.1 >> "data\server.log" 2>&1
echo ===== %date% %time% server.cmd: npm start ended, exit code %errorlevel% =====>> "data\server.log"
