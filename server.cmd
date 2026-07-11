@echo off
title Mission Control Server
cd /d "%~dp0"

rem Don't double-start if something already owns port 3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 exit /b

rem Agent CLIs the server spawns must be resolvable no matter what PATH this
rem process inherited (a boot-time PATH once missed the Claude native install
rem and the bridge showed offline). Prepend the known install dirs.
set "PATH=%USERPROFILE%\.local\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\Ollama;%PATH%"

rem -H 127.0.0.1: never expose the dashboard (which can run commands) to the LAN
npm start -- -H 127.0.0.1
