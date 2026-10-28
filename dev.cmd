@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20+ and pnpm first.
  pause
  exit /b 1
)
node scripts/dev-menu.mjs
pause
