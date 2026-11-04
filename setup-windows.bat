@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Arcane Table - setup
echo.
echo  === Arcane Table: first-time setup ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Installing it with winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  Could not install Node.js automatically.
    echo  Please install it from https://nodejs.org ^(the LTS version^), then run this file again.
    pause
    exit /b 1
  )
  echo.
  echo  Node.js is installed. Close this window and double-click setup-windows.bat again.
  pause
  exit /b 0
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo  Your Node.js is too old. Please install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  Installing pnpm...
  call npm install -g pnpm@10.28.0
  if errorlevel 1 goto fail
)

echo  Downloading the parts the game needs (this takes a few minutes the first time)...
call pnpm install
if errorlevel 1 goto fail

echo  Building the website...
call pnpm --filter @vtt/web build
if errorlevel 1 goto fail

if not exist apps\server\.env copy apps\server\.env.play.example apps\server\.env >nul

echo.
echo  Setup finished! Double-click start-windows.bat to play.
echo.
pause
exit /b 0

:fail
echo.
echo  Setup failed. Scroll up to see the error, or send a screenshot of this window.
pause
exit /b 1
