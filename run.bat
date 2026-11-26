@echo off
setlocal
cd /d "%~dp0"

set "URL=http://localhost:5174/"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install LTS from https://nodejs.org and retry.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing Motif dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

netstat -ano | findstr /r /c:":5174 .*LISTENING" >nul
if not errorlevel 1 (
  echo Motif dev server already running at %URL%
  start "" "%URL%"
  exit /b 0
)

echo Starting Motif dev server on %URL% (Ctrl+C to stop)
call npm run dev -- --open /
pause
