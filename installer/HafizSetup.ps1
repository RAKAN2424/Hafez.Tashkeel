$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { $Host.UI.RawUI.WindowTitle = "Hafiz Bel'Amya - Setup & Auto-Launcher" } catch {}

try {
  $Root = (Get-Location).Path
  $DlDir = Join-Path $env:TEMP 'HafizBelAmyaSetup'
  if (-not (Test-Path $DlDir)) { New-Item -ItemType Directory -Path $DlDir -Force | Out-Null }

  Write-Host '============================================================================' -ForegroundColor Cyan
  Write-Host "  Hafiz Bel'Amya - Automated Setup & Launcher" -ForegroundColor Cyan
  Write-Host '============================================================================' -ForegroundColor Cyan
  Write-Host "Working Directory: $Root"
  Write-Host ''

  function Refresh-EnvPath {
    $m = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @(
      'C:\Program Files\nodejs',
      (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\Scripts'),
      'C:\Python311',
      'C:\Python311\Scripts'
    ) -join ';'
    $env:Path = "$m;$u;$extra;$env:Path"
  }

  Refresh-EnvPath

  function Ensure-Tool {
    param([string]$Cmd, [string]$Title, [string]$WingetId, [string]$Url, [string]$FileName)
    if (Get-Command $Cmd -ErrorAction SilentlyContinue) {
      Write-Host "[OK] $Title detected." -ForegroundColor Green
      return $true
    }
    Write-Host "[MISSING] $Title not found." -ForegroundColor Yellow
    if (Get-Command 'winget' -ErrorAction SilentlyContinue) {
      Write-Host "  -> Installing $Title via winget..." -ForegroundColor Cyan
      winget install --id $WingetId --silent --accept-package-agreements --accept-source-agreements
      Refresh-EnvPath
      if (Get-Command $Cmd -ErrorAction SilentlyContinue) {
        Write-Host "[OK] $Title installed." -ForegroundColor Green
        return $true
      }
    }
    $dest = Join-Path $DlDir $FileName
    Write-Host "  -> Downloading $Title from $Url ..." -ForegroundColor Cyan
    try {
      Invoke-WebRequest -Uri $Url -OutFile $dest -UseBasicParsing
      if ($dest.EndsWith('.msi')) {
        Start-Process msiexec.exe -ArgumentList "/i `"$dest`" /passive" -Wait
      } elseif ($dest.EndsWith('.exe')) {
        Start-Process $dest -ArgumentList '/passive PrependPath=1 Include_test=0' -Wait
      } elseif ($dest.EndsWith('.zip')) {
        $ffDir = Join-Path $Root 'installer\ffmpeg'
        Expand-Archive -Path $dest -DestinationPath $ffDir -Force
        $binDir = Get-ChildItem -Path $ffDir -Recurse -Directory -Filter 'bin' | Select-Object -First 1
        if ($binDir) { $env:Path = "$($binDir.FullName);$env:Path" }
      }
      Refresh-EnvPath
    } catch {
      Write-Host "[WARN] Download error: $_" -ForegroundColor Red
    }
    return [bool](Get-Command $Cmd -ErrorAction SilentlyContinue)
  }

  Write-Host '[1/5] Checking System Tools (Python 3.11, Node.js 20, FFmpeg)...' -ForegroundColor White
  $hasPy = Ensure-Tool 'python' 'Python 3.11' 'Python.Python.3.11' 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' 'python-3.11.9-amd64.exe'
  $hasNode = Ensure-Tool 'node' 'Node.js 20 LTS' 'OpenJS.NodeJS.LTS' 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi' 'node-v20.18.1-x64.msi'
  $null = Ensure-Tool 'ffmpeg' 'FFmpeg' 'Gyan.FFmpeg' 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' 'ffmpeg-release-essentials.zip'

  if (-not $hasPy) {
    Write-Host '[ERROR] Python is required to install AI backends. Finish Python installation then run setup.exe again.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
  }

  $InProjectRoot = (Test-Path (Join-Path $Root 'package.json')) -and (Test-Path (Join-Path $Root 'server.ts'))

  if ($InProjectRoot) {
    $LocalModelsDir = Join-Path $Root 'models\local'
    if (-not (Test-Path $LocalModelsDir)) { New-Item -ItemType Directory -Path $LocalModelsDir -Force | Out-Null }

    Write-Host ''
    Write-Host '[2/5] Checking Node.js dependencies...' -ForegroundColor White
    $TsxCmd = Join-Path $Root 'node_modules\.bin\tsx.cmd'
    if ($hasNode -and (-not (Test-Path $TsxCmd))) {
      Write-Host '  -> Running npm install --include=dev ...' -ForegroundColor Cyan
      & npm.cmd install --include=dev
      if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed with exit code $LASTEXITCODE." -ForegroundColor Red
      }
    } else {
      Write-Host '[OK] Node.js dependencies and tsx runtime ready.' -ForegroundColor Green
    }

    Write-Host ''
    Write-Host '[3/5] Checking Python environment & required AI backends...' -ForegroundColor White
    $PyExe = Join-Path $Root '.venv\Scripts\python.exe'
    if (-not (Test-Path $PyExe)) {
      Write-Host '  -> Creating .venv...' -ForegroundColor Cyan
      & python -m venv .venv
    }
    if (-not (Test-Path $PyExe)) { $PyExe = 'python' }
  } else {
    Write-Host ''
    Write-Host '[STANDALONE MODE] App folder (package.json) not found next to setup.exe.' -ForegroundColor Yellow
    Write-Host 'Installing required AI Python backends so the app is ready when placed in the Hafiz folder...' -ForegroundColor Cyan
    $PyExe = 'python'
  }

  $ReqPath = Join-Path $Root 'requirements.txt'
  if (Test-Path $ReqPath) {
    & $PyExe -m pip install -r $ReqPath --quiet
  } else {
    & $PyExe -m pip install llama-cpp-python torch torchaudio transformers accelerate safetensors sentencepiece protobuf huggingface_hub einops peft faster-whisper ctranslate2 soundfile librosa scipy piper-tts onnxruntime requests --quiet
  }

  Write-Host ''
  Write-Host '[4/5] Checking NVIDIA CUDA acceleration status (critical check only)...' -ForegroundColor Cyan
  $hasGpu = [bool](Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue)
  if ($hasGpu) {
    $pyCuda = @'
import sys
missing = []
try:
    import torch
    if not getattr(torch.version, 'cuda', None):
        missing.append('torch')
except Exception:
    missing.append('torch')
try:
    import llama_cpp
    fn = getattr(llama_cpp, 'llama_supports_gpu_offload', None)
    if callable(fn) and not fn():
        missing.append('llama-cpp-python')
except Exception:
    pass
print(','.join(missing))
'@
    $needCu = (& $PyExe -c $pyCuda 2>$null | Out-String).Trim()
    if ($needCu -match 'torch') {
      Write-Host '[CUDA] Installing PyTorch CUDA 12.4 wheel for NVIDIA GPU...' -ForegroundColor Green
      & $PyExe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
    }
    if ($needCu -match 'llama-cpp-python') {
      Write-Host '[CUDA] Installing llama-cpp-python CUDA 12.4 wheel...' -ForegroundColor Green
      & $PyExe -m pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124
    }
    if (-not $needCu) {
      Write-Host '[OK] NVIDIA CUDA GPU acceleration is already active.' -ForegroundColor Green
    }
  } else {
    Write-Host '[INFO] No NVIDIA GPU detected; CPU mode active.' -ForegroundColor DarkCyan
  }

  Write-Host ''
  Write-Host '[5/5] Scanning mounted partitions (C:, D:, E:, ...) for AI models...' -ForegroundColor Green
  $sub = @('AI\LMStudio-Models\local','LMStudio-Models\local','OmniVoice','Models','models\local','.lmstudio\models','.cache\huggingface\hub')
  $drv = @([System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady -and ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable') })
  $hits = @()
  foreach ($d in $drv) {
    foreach ($s in $sub) { $p = Join-Path $d.Name $s; if (Test-Path $p) { $hits += $p } }
  }
  foreach ($s in @('.lmstudio\models','.cache\huggingface\hub')) { $p = Join-Path $env:USERPROFILE $s; if (Test-Path $p) { $hits += $p } }
  if ($hits.Count -gt 0) {
    $hits = @($hits | Select-Object -Unique)
    Write-Host ('[FOUND] Model roots: ' + ($hits -join ' ; ')) -ForegroundColor Cyan
  } else {
    Write-Host '[INFO] Partition auto-scan will run inside Hafiz Server on boot.' -ForegroundColor DarkCyan
  }

  if ($InProjectRoot -and $hasNode) {
    if ($PyExe -ne 'python') { $env:PYTHON_BIN = $PyExe }
    $env:DISABLE_HMR = 'true'
    $env:HAFIZ_AUTO_SCAN_PARTITIONS = '1'
    $env:NODE_ENV = 'development'

    Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile',
      '-Command',
      "for(`$i=0;`$i -lt 45;`$i++){try{`$r=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/setup/status' -UseBasicParsing -TimeoutSec 2;if(`$r.StatusCode -eq 200){Start-Process 'http://localhost:3000';break}}catch{};Start-Sleep -Seconds 1}"
    ) | Out-Null

    Write-Host "[Server] Starting Hafiz Bel'Amya on http://localhost:3000 ..." -ForegroundColor Green
    $LocalTsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
    if (Test-Path $LocalTsx) {
      & $LocalTsx server.ts
    } elseif (Get-Command 'npx.cmd' -ErrorAction SilentlyContinue) {
      & npx.cmd --yes tsx server.ts
    } else {
      & npx tsx server.ts
    }
  } elseif ($InProjectRoot -and (-not $hasNode)) {
    Write-Host '[ERROR] Node.js 20+ was not found on PATH. Install Node.js LTS from https://nodejs.org then run setup.exe or start_hafiz.bat.' -ForegroundColor Red
  } else {
    Write-Host ''
    Write-Host '[DONE] Dependencies ready! Place setup.exe inside the Hafiz project folder and run again to start.' -ForegroundColor Green
  }
} catch {
  Write-Host ''
  Write-Host "[SETUP ERROR] $_" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Press Enter to close'
