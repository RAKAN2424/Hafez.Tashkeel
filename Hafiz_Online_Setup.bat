@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Hafiz Bel'Amya - Online Setup & Models Installer

echo ============================================================================
echo   Hafiz Bel'Amya (Egyptian Studio Pro) - Complete Windows Online Installer
echo ============================================================================
echo.

set "SRC_DIR=%~dp0"
if "%SRC_DIR:~-1%"=="\" set "SRC_DIR=%SRC_DIR:~0,-1%"

set "DEFAULT_DIR=C:\HafizBelAmya"
set /p "INSTALL_DIR=Install folder [%DEFAULT_DIR%] (or press Enter for current folder '%SRC_DIR%'): "
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%SRC_DIR%"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\models" mkdir "%INSTALL_DIR%\models"

if /I not "%SRC_DIR%"=="%INSTALL_DIR%" (
  echo.
  echo [1/6] Copying application files to "%INSTALL_DIR%"...
  robocopy "%SRC_DIR%" "%INSTALL_DIR%" /E /XD node_modules .venv dist .git /XF *.exe >nul
) else (
  echo [1/6] Using current directory "%INSTALL_DIR%"...
)

cd /d "%INSTALL_DIR%"
if not exist "models" mkdir "models"

echo.
echo [2/6] Checking Node.js, Python 3.11, and FFmpeg (downloading missing tools)...
call :RefreshEnv

where node >nul 2>&1
if errorlevel 1 (
  echo [Download] Node.js not found. Installing Node.js 20 LTS from Internet...
  where winget >nul 2>&1
  if !errorlevel!==0 (
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi' -OutFile '$env:TEMP\node20.msi'; Start-Process msiexec.exe -Wait -ArgumentList '/i', '$env:TEMP\node20.msi', '/qn'"
  )
  call :RefreshEnv
)

where python >nul 2>&1
if errorlevel 1 (
  echo [Download] Python not found. Installing Python 3.11 from Internet...
  where winget >nul 2>&1
  if !errorlevel!==0 (
    winget install --id Python.Python.3.11 -e --accept-package-agreements --accept-source-agreements
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile '$env:TEMP\py311.exe'; Start-Process '$env:TEMP\py311.exe' -Wait -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_pip=1'"
  )
  call :RefreshEnv
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [Download] FFmpeg not found. Installing FFmpeg via winget...
  where winget >nul 2>&1
  if !errorlevel!==0 (
    winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
    call :RefreshEnv
  ) else (
    echo [Notice] winget not found; FFmpeg optional download skipped. You can install FFmpeg later.
  )
)

echo.
echo [3/6] Installing Node.js dependencies from npm...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed. Check your internet connection and Node.js installation.
  pause
  exit /b 1
)

echo.
echo [4/6] Setting up Python virtual environment (.venv)...
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
)
set "VENV_PY=.venv\Scripts\python.exe"
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel

echo.
echo [5/6] Downloading AI backends (PyTorch CUDA/CPU, llama-cpp-python, Whisper, OmniVoice)...
where nvidia-smi >nul 2>&1
if %errorlevel%==0 (
  echo [GPU] NVIDIA GPU detected! Installing CUDA 12.4 PyTorch + CUDA llama-cpp-python...
  "%VENV_PY%" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
  "%VENV_PY%" -m pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124
) else (
  echo [CPU] Installing standard PyTorch + llama-cpp-python...
)
"%VENV_PY%" -m pip install -r requirements.txt
"%VENV_PY%" -m pip install openai-whisper --quiet
"%VENV_PY%" -m pip install TTS --quiet
"%VENV_PY%" -m pip install omnivoice --quiet

echo.
echo [6/6] Creating Desktop shortcuts (App + Models Folder)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir = $env:INSTALL_DIR; $ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s1 = $ws.CreateShortcut((Join-Path $desk 'Hafiz BelAmya.lnk')); $s1.TargetPath = (Join-Path $dir 'start_hafiz.bat'); $s1.WorkingDirectory = $dir; $s1.Save(); $s2 = $ws.CreateShortcut((Join-Path $desk 'Hafiz Models Folder.lnk')); $s2.TargetPath = (Join-Path $dir 'models'); $s2.Save()"

echo.
echo ============================================================================
echo   Setup Complete!
echo   Models Folder: %INSTALL_DIR%\models
echo   Copy/Move your model folders inside "%INSTALL_DIR%\models" and launch!
echo ============================================================================
start "" explorer.exe "%INSTALL_DIR%\models"
set /p "RUN_NOW=Start Hafiz Bel'Amya now? [Y/n]: "
if /I not "%RUN_NOW%"=="n" (
  call "%INSTALL_DIR%\start_hafiz.bat"
)
exit /b 0

:RefreshEnv
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=%SYS_PATH%;%USR_PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;C:\Python311;C:\Python311\Scripts;%PATH%"
exit /b 0
