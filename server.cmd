@echo off
title Mission Control Server
cd /d "%~dp0"

rem Don't double-start if something already owns port 3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 exit /b

rem -H 127.0.0.1: never expose the dashboard (which can run commands) to the LAN
npm start -- -H 127.0.0.1
