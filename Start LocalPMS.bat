@echo off
title LocalPMS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing LocalPMS for the first time - this takes a minute...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
set OPEN_BROWSER=1
call npm start
pause
