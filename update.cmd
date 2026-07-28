@echo off
title Mission Control Updater
cd /d "%~dp0"

echo ============================================
echo   Updating Mission Control from GitHub
echo ============================================
echo.

echo [1/4] Pulling latest code...
git pull
if errorlevel 1 (
  echo.
  echo git pull failed. If it mentions local changes, note that data\ and
  echo .env.local are per-machine and git-ignored, so a normal install should
  echo pull cleanly. Resolve the message above and re-run.
  pause
  exit /b 1
)

echo.
echo [2/4] Installing dependencies...
call npm install

echo.
echo [3/4] Building...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed - NOT restarting so the old version keeps serving.
  pause
  exit /b 1
)

echo.
echo [4/4] Restarting server...
rem Free port 3000 so the boot server can serve the freshly built code.
rem This used to parse `netstat | findstr ":3000 "` and taskkill token 5. That
rem was unsafe: findstr OR-splits on the space, so an IPv6 address merely
rem CONTAINING the hextet 3000 matched, and token 5 of that line is a STRANGER'S
rem pid — which then got `taskkill /f`ed. Ask Windows for the port's real owner
rem instead (same approach stop.cmd uses).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
start "" /min server.cmd

echo.
echo ============================================
echo   Done. Mission Control is restarting at
echo   http://127.0.0.1:3000
echo ============================================
echo.
echo If this is a different machine than where the keys were entered, open
echo Settings and re-add: API Keys (Studio) and the WordPress connection.
echo Those are stored per-machine and are never synced.
echo.
pause
