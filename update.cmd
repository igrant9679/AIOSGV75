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
rem Free port 3000 so the boot server can serve the freshly built code
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
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
