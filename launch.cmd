@echo off
title Mission Control
cd /d "%~dp0"

rem If the server is already running, just open the dashboard.
rem /C: is REQUIRED — see the long note in server.cmd. Without it findstr
rem OR-splits on the space and matches IPv6 addresses containing ":3000".
netstat -ano | findstr /C:":3000 " | findstr /C:"LISTENING" >nul
if %errorlevel%==0 (
  echo Mission Control is already running - opening it...
  start "" http://localhost:3000
  exit /b
)

echo Starting Mission Control... the dashboard will open shortly.
echo Keep this window open while you use it ^(Ctrl+C to shut down^).
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3000"
npm run dev -- -H 127.0.0.1
