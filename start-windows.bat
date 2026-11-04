@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Arcane Table
if not exist apps\web\dist\index.html (
  echo  The game isn't set up yet. Double-click setup-windows.bat first.
  pause
  exit /b 1
)
echo  Starting Arcane Table... the browser opens by itself in a moment.
echo  Keep this window open while you play. Close it to stop the game.
call pnpm play
pause
