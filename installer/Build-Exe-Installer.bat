@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

echo ============================================================================
echo   Building Standalone HafizBelAmya-Setup.exe using Windows Built-in .NET
echo ============================================================================
echo.

set "CSC_EXE="
if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC_EXE=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if "%CSC_EXE%"=="" if exist "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC_EXE=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if "%CSC_EXE%"=="" (
  echo [ERROR] .NET Framework csc.exe not found on this machine.
  echo You can still run Hafiz_Online_Setup.bat directly without building an EXE!
  pause
  exit /b 1
)

set "PAYLOAD_ZIP=%TEMP%\HafizPayload.zip"
if exist "%PAYLOAD_ZIP%" del /f /q "%PAYLOAD_ZIP%"

echo [1/2] Packing project source files (excluding node_modules, .venv, dist)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$src = (Get-Location).Path; $stage = Join-Path $env:TEMP 'hafiz_stage'; if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }; New-Item -ItemType Directory -Path $stage | Out-Null; robocopy $src $stage /E /XD node_modules .venv dist .git .aistudio /XF *.exe | Out-Null; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, '%PAYLOAD_ZIP%'); Remove-Item -Recurse -Force $stage"

if not exist "%PAYLOAD_ZIP%" (
  echo [ERROR] Failed to create payload archive.
  pause
  exit /b 1
)

echo [2/2] Compiling HafizBelAmya-Setup.exe...
"%CSC_EXE%" /nologo /target:winexe /optimize+ /out:"%CD%\HafizBelAmya-Setup.exe" /resource:"%PAYLOAD_ZIP%,HafizPayload.zip" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "%~dp0HafizInstaller.cs"

if exist "%PAYLOAD_ZIP%" del /f /q "%PAYLOAD_ZIP%"

if errorlevel 1 (
  echo [ERROR] Compilation failed.
  pause
  exit /b 1
)

echo.
echo ============================================================================
echo   SUCCESS! Built standalone Windows installer:
echo   %CD%\HafizBelAmya-Setup.exe
echo ============================================================================
pause
