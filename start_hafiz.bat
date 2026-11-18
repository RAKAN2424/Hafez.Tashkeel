@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Hafiz Bel'Amya (Egyptian Studio Pro)
set "DISABLE_HMR=true"
set "HAFIZ_AUTO_SCAN_PARTITIONS=1"

echo ============================================================================
echo   Starting Hafiz Bel'Amya Studio on http://localhost:3000
echo ============================================================================
echo.

if not exist "node_modules" (
  echo [Setup] Installing Node.js packages for first launch...
  call npm install
)

if exist ".venv\Scripts\python.exe" (
  set "PYTHON_BIN=%~dp0.venv\Scripts\python.exe"
  echo [Python] Using virtual environment: %PYTHON_BIN%
) else (
  echo [Python] Using system Python from PATH
)

:: Poll port 3000 cleanly in background and open browser only once server is ready
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 45;$i++){try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/setup/status' -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){Start-Process 'http://localhost:3000';break}}catch{};Start-Sleep -Seconds 1}"

echo [Server] Launching Hafiz Bel'Amya backend and UI...
echo Keep this window open while using the app. Press Ctrl+C to stop and unload GPU VRAM.
echo.
call npx tsx server.ts
echo.
echo [Info] Hafiz Bel'Amya Server stopped.
pause
