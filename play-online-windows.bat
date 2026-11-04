@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Arcane Table - online link
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo  Installing cloudflared ^(free, from Cloudflare^)...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo  Could not install cloudflared. See docs\PLAY_ONLINE.md for other ways.
    pause
    exit /b 1
  )
  echo.
  echo  Installed. Close this window and double-click play-online-windows.bat again.
  pause
  exit /b 0
)
echo.
echo  1. Keep start-windows.bat running in its own window.
echo  2. Below, find the line with  https://something.trycloudflare.com
echo  3. Send that link to your friends. It changes every time you run this.
echo  Close this window to stop sharing.
echo.
cloudflared tunnel --no-autoupdate --url http://localhost:3001
pause
