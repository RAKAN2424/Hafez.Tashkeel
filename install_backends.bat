@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================================
echo   Hafiz Bel'Amya - Complete Local Backends & Dependencies Installer
echo ============================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed! Please install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed! Please install Python 3.10 or 3.11 from https://python.org
  pause
  exit /b 1
)

echo [1/4] Installing Node.js dependencies (npm install)...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Setting up Python virtual environment (.venv)...
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
)
set "VENV_PY=.venv\Scripts\python.exe"
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel

echo.
echo [3/4] Detecting NVIDIA GPU for CUDA acceleration...
where nvidia-smi >nul 2>&1
if %errorlevel%==0 (
  echo [GPU] NVIDIA GPU detected! Installing CUDA PyTorch + CUDA llama-cpp-python...
  "%VENV_PY%" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
  "%VENV_PY%" -m pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124
) else (
  echo [CPU] No NVIDIA GPU detected via nvidia-smi. Installing standard wheels...
)

echo.
echo [4/4] Installing remaining Python AI backends from requirements.txt...
"%VENV_PY%" -m pip install -r requirements.txt

echo.
echo [Optional Extras] Installing openai-whisper, TTS, and omnivoice (best effort)...
"%VENV_PY%" -m pip install openai-whisper --quiet
"%VENV_PY%" -m pip install TTS --quiet
"%VENV_PY%" -m pip install omnivoice --quiet

echo.
echo ============================================================================
echo   Installation Complete! You can now double-click start_hafiz.bat to launch.
echo ============================================================================
pause
