@echo off
title B-E Motion
cd /d "%~dp0"
echo.
echo   B-E Motion
echo   ==========
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run B-E Motion on this computer.
  echo Your browser will open the Node.js download page. Install the LTS version,
  echo then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if not exist node_modules (
  echo First start: installing, this takes a minute...
  call npm ci
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo Starting... your browser will open B-E Motion. Keep this window open while you use it.
call npm run dev -- --open
pause
