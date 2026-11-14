@echo off
title Reel
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Reel needs Node.js, which is not installed yet.
  echo A download page will open. Install the LTS version with the default options,
  echo then double-click this file again.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
node scripts\launch.mjs
echo.
echo Reel has stopped. You can close this window.
pause
