@echo off
title Mission Control
cd /d "%~dp0"

rem If the server is already running, just open the dashboard
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo Mission Control is already running - opening it...
  start "" http://localhost:3000
  exit /b
)

echo Starting Mission Control... the dashboard will open shortly.
echo Keep this window open while you use it ^(Ctrl+C to shut down^).
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3000"
npm run dev -- -H 127.0.0.1
