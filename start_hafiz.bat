@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Hafiz Bel'Amya (Egyptian Studio Pro)
set "DISABLE_HMR=true"
set "HAFIZ_AUTO_SCAN_PARTITIONS=1"
set "NODE_ENV=development"

:: Refresh common install paths in case Node/Python were installed recently
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;C:\Python311;C:\Python311\Scripts"

echo ============================================================================
echo   Starting Hafiz Bel'Amya Studio on http://localhost:3000
echo ============================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ was not found on this machine.
  echo Please install Node.js LTS from https://nodejs.org or run setup.exe first.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo [Setup] Installing Node.js packages for first launch...
  call npm install --include=dev
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if exist ".venv\Scripts\python.exe" (
  set "PYTHON_BIN=%~dp0.venv\Scripts\python.exe"
  echo [Python] Using virtual environment: %PYTHON_BIN%
) else (
  echo [Python] Using system Python from PATH
)

:: Wait for http://127.0.0.1:3000/api/setup/status in a separate hidden PowerShell process
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 45;$i++){try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/setup/status' -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){Start-Process 'http://localhost:3000';break}}catch{};Start-Sleep -Seconds 1}"

echo [Server] Launching Hafiz Bel'Amya backend and UI...
echo Keep this window open while using the app. Press Ctrl+C to stop and unload GPU VRAM.
echo.

if exist "node_modules\.bin\tsx.cmd" (
  call "node_modules\.bin\tsx.cmd" server.ts
) else (
  call npx --yes tsx server.ts
)

echo.
if errorlevel 1 (
  echo [ERROR] Hafiz Bel'Amya Server exited with error code %errorlevel%.
) else (
  echo [Info] Hafiz Bel'Amya Server stopped.
)
pause
