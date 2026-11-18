@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Hafiz Bel'Amya (Egyptian Studio Pro)

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

:: Open browser automatically in background once server listens on port 3000
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

echo [Server] Launching Hafiz Bel'Amya backend and UI...
echo Keep this window open while using the app. Press Ctrl+C to stop and unload GPU VRAM.
echo.
call npx tsx server.ts
pause
