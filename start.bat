@echo off
title SafeZone
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if not exist backend\node_modules call npm --prefix backend install --omit=dev
if not exist frontend\dist\index.html (
  call npm --prefix frontend install
  call npm --prefix frontend run build
)
echo.
echo Starting SafeZone... your browser will open at http://localhost:4000
start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:4000"
cd backend
node src/server.js
pause