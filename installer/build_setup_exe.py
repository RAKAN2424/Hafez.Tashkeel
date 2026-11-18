#!/usr/bin/env python3
"""
Builds a genuine, 100% self-contained 64-bit Windows PE32+ executable (`setup.exe`)
with:
  - Embedded Hafiz Bel'Amya multi-resolution Windows icon (`.rsrc`)
  - Self-contained automated installer & launcher script embedded via PowerShell -EncodedCommand
    (zero external .bat / .ps1 setup files required)
  - ASLR-compatible RIP-relative x64 machine code importing only kernel32.dll & user32.dll
"""

from pathlib import Path
import base64
import os
import struct
import subprocess
import tempfile
import zlib


POWERSHELL_SETUP_SCRIPT = r"""
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Hafiz Bel'Amya - Setup & Auto-Launcher"

try {
  $Root = (Get-Location).Path
  $DlDir = Join-Path $env:TEMP 'HafizBelAmyaSetup'
  if (-not (Test-Path $DlDir)) { New-Item -ItemType Directory -Path $DlDir -Force | Out-Null }

  Write-Host '============================================================================' -ForegroundColor Cyan
  Write-Host "  Hafiz Bel'Amya - Standalone Automated Setup (.exe)" -ForegroundColor Cyan
  Write-Host '============================================================================' -ForegroundColor Cyan
  Write-Host "Working Directory: $Root"
  Write-Host ''

  function Refresh-EnvPath {
    $m = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u"
  }

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
      Start-Process $Url
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
    if ($hasNode -and (-not (Test-Path (Join-Path $Root 'node_modules')))) {
      & npm.cmd install
    }
    Write-Host ''
    Write-Host '[3/5] Checking Python environment & required AI backends...' -ForegroundColor White
    $PyExe = Join-Path $Root '.venv\Scripts\python.exe'
    if (-not (Test-Path $PyExe)) {
      Write-Host '  -> Creating .venv...' -ForegroundColor Cyan
      python -m venv .venv
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
    Start-Job -ScriptBlock {
      for ($i = 0; $i -lt 45; $i++) {
        try {
          $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/setup/status' -UseBasicParsing -TimeoutSec 2
          if ($r.StatusCode -eq 200) { Start-Process 'http://localhost:3000'; break }
        } catch {}
        Start-Sleep -Seconds 1
      }
    } | Out-Null
    Write-Host '[Server] Starting Hafiz Bel''Amya on http://localhost:3000 ...' -ForegroundColor Green
    if (Get-Command 'npx.cmd' -ErrorAction SilentlyContinue) {
      & npx.cmd tsx server.ts
    } else {
      & npx tsx server.ts
    }
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
""".strip()


def make_png_rgba(size: int) -> bytes:
    """Create a clean RGBA PNG icon (deep navy rounded badge + indigo ring + gold diamond nib)."""
    rows = bytearray()
    cx = (size - 1) / 2.0
    cy = (size - 1) / 2.0
    radius = size * 0.45
    inner_r = size * 0.28

    for y in range(size):
        rows.append(0)
        for x in range(size):
            dx = x - cx
            dy = y - cy
            ax = abs(dx)
            ay = abs(dy)
            corner = size * 0.26
            limit = size * 0.47 - corner
            qx = max(ax - limit, 0.0)
            qy = max(ay - limit, 0.0)
            sq_dist = (qx * qx + qy * qy) ** 0.5

            if sq_dist > corner + 0.7:
                rows.extend((0, 0, 0, 0))
                continue

            alpha = 255
            if sq_dist > corner - 0.5:
                alpha = max(0, min(255, int(255 * (corner + 0.7 - sq_dist) / 1.2)))

            dist = (dx * dx + dy * dy) ** 0.5
            t = y / max(1, size - 1)
            r = int(15 + t * 18)
            g = int(23 + t * 10)
            b = int(42 + t * 48)

            if abs(dist - radius * 0.78) <= max(1.2, size * 0.055):
                r, g, b = 99, 102, 241

            manhattan = abs(dx) + abs(dy * 0.85)
            if manhattan <= inner_r * 0.92:
                r, g, b = (253, 224, 104) if (dx + dy < 0) else (245, 178, 36)
            elif abs(dx) <= max(1.0, size * 0.03) and 0 < dy < inner_r * 1.15:
                r, g, b = 255, 255, 255

            rows.extend((r, g, b, alpha))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(rows), 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def make_bmp_icon_32(size: int = 32) -> bytes:
    """Create a 32-bit DIB icon bitmap for classic Windows Explorer icon rendering."""
    cx = (size - 1) / 2.0
    cy = (size - 1) / 2.0
    radius = size * 0.45
    inner_r = size * 0.28

    header = struct.pack(
        "<IIIHHIIIIII",
        40, size, size * 2, 1, 32, 0, size * size * 4, 0, 0, 0, 0,
    )
    pixels = bytearray()
    and_mask = bytearray(((size + 31) // 32) * 4 * size)

    for y in range(size - 1, -1, -1):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            ax = abs(dx)
            ay = abs(dy)
            corner = size * 0.26
            limit = size * 0.47 - corner
            qx = max(ax - limit, 0.0)
            qy = max(ay - limit, 0.0)
            sq_dist = (qx * qx + qy * qy) ** 0.5

            if sq_dist > corner + 0.7:
                pixels.extend((0, 0, 0, 0))
                row_idx = (size - 1 - y) * (((size + 31) // 32) * 4)
                and_mask[row_idx + (x // 8)] |= 1 << (7 - (x % 8))
                continue

            dist = (dx * dx + dy * dy) ** 0.5
            t = y / max(1, size - 1)
            r = int(15 + t * 18)
            g = int(23 + t * 10)
            b = int(42 + t * 48)
            if abs(dist - radius * 0.78) <= max(1.2, size * 0.055):
                r, g, b = 99, 102, 241
            manhattan = abs(dx) + abs(dy * 0.85)
            if manhattan <= inner_r * 0.92:
                r, g, b = (253, 224, 104) if (dx + dy < 0) else (245, 178, 36)
            pixels.extend((b, g, r, 255))

    return header + bytes(pixels) + bytes(and_mask)


def align_up(val: int, align: int) -> int:
    return (val + align - 1) & ~(align - 1)


def build_rsrc_section(rsrc_rva: int, icons: list[tuple[int, int, bytes]]) -> bytes:
    buf = bytearray()

    def write_dir(named_count: int, id_entries: list[tuple[int, int, bool]]):
        buf.extend(struct.pack("<IIHHHH", 0, 0, 0, 0, named_count, len(id_entries)))
        for res_id, offset, is_dir in id_entries:
            val = offset | (0x80000000 if is_dir else 0)
            buf.extend(struct.pack("<II", res_id, val))

    grp = bytearray(struct.pack("<HHH", 0, 1, len(icons)))
    for idx, (w, bpp, img) in enumerate(icons, start=1):
        wb = 0 if w >= 256 else w
        grp.extend(struct.pack("<BBBBHHIH", wb, wb, 0, 0, 1, bpp, len(img), idx))

    n = len(icons)
    off_root = 0
    off_type_icon = off_root + 32
    off_type_group = off_type_icon + 16 + n * 8
    off_lang_icons_start = off_type_group + 16 + 8
    off_lang_group = off_lang_icons_start + n * 24
    off_data_entries = off_lang_group + 24
    off_blobs = align_up(off_data_entries + (n + 1) * 16, 8)

    write_dir(0, [(3, off_type_icon, True), (14, off_type_group, True)])
    write_dir(0, [(idx, off_lang_icons_start + (idx - 1) * 24, True) for idx in range(1, n + 1)])
    write_dir(0, [(1, off_lang_group, True)])
    for idx in range(n):
        write_dir(0, [(0x0409, off_data_entries + idx * 16, False)])
    write_dir(0, [(0x0409, off_data_entries + n * 16, False)])

    blobs = bytearray()
    cur = off_blobs
    for idx, (_w, _bpp, img) in enumerate(icons):
        img_rva = rsrc_rva + cur
        buf.extend(struct.pack("<IIII", img_rva, len(img), 0, 0))
        blobs.extend(img)
        pad = align_up(len(img), 8) - len(img)
        blobs.extend(b"\x00" * pad)
        cur += len(img) + pad

    grp_rva = rsrc_rva + cur
    buf.extend(struct.pack("<IIII", grp_rva, len(grp), 0, 0))
    blobs.extend(grp)

    while len(buf) < off_blobs:
        buf.append(0)
    buf.extend(blobs)
    return bytes(buf)


def utf16z(s: str) -> bytes:
    return (s + "\0").encode("utf-16-le")


def build_rdata(rdata_rva: int):
    buf = bytearray()
    sym: dict[str, int] = {}

    def add_bytes(name: str, data: bytes, align: int = 2):
        while (len(buf) % align) != 0:
            buf.append(0)
        sym[name] = rdata_rva + len(buf)
        buf.extend(data)

    encoded_ps = base64.b64encode(POWERSHELL_SETUP_SCRIPT.encode("utf-16-le")).decode("ascii")
    ps_cmd = f"powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded_ps}"
    assert len(ps_cmd) < 28000, f"Embedded PowerShell command too long ({len(ps_cmd)} chars)"

    add_bytes("cmd_embedded_setup", utf16z(ps_cmd))
    add_bytes(
        "str_err_msg",
        utf16z(
            "Hafiz Bel'Amya Setup could not start PowerShell on this machine.\n\n"
            "Please ensure Windows PowerShell 5.1+ is enabled and try again."
        ),
    )
    add_bytes("str_err_title", utf16z("Hafiz Bel'Amya Setup"))

    k32_funcs = [
        "GetModuleFileNameW",
        "SetCurrentDirectoryW",
        "CreateProcessW",
        "WaitForSingleObject",
        "GetExitCodeProcess",
        "CloseHandle",
        "ExitProcess",
    ]
    u32_funcs = ["MessageBoxW"]

    while (len(buf) % 8) != 0:
        buf.append(0)

    idt_off = len(buf)
    sym["import_dir"] = rdata_rva + idt_off
    buf.extend(b"\x00" * 64)

    k32_ilt_off = len(buf)
    buf.extend(b"\x00" * ((len(k32_funcs) + 1) * 8))
    u32_ilt_off = len(buf)
    buf.extend(b"\x00" * ((len(u32_funcs) + 1) * 8))

    k32_iat_off = len(buf)
    sym["iat_start"] = rdata_rva + k32_iat_off
    for fn in k32_funcs:
        sym[f"iat_{fn}"] = rdata_rva + len(buf)
        buf.extend(b"\x00" * 8)
    buf.extend(b"\x00" * 8)

    u32_iat_off = len(buf)
    for fn in u32_funcs:
        sym[f"iat_{fn}"] = rdata_rva + len(buf)
        buf.extend(b"\x00" * 8)
    buf.extend(b"\x00" * 8)
    sym["iat_end"] = rdata_rva + len(buf)

    add_bytes("dll_kernel32", b"kernel32.dll\0", 2)
    add_bytes("dll_user32", b"user32.dll\0", 2)

    k32_hn_rvas = []
    for fn in k32_funcs:
        key = f"hn_{fn}"
        add_bytes(key, b"\x00\x00" + fn.encode("ascii") + b"\x00", 2)
        k32_hn_rvas.append(sym[key])

    u32_hn_rvas = []
    for fn in u32_funcs:
        key = f"hn_{fn}"
        add_bytes(key, b"\x00\x00" + fn.encode("ascii") + b"\x00", 2)
        u32_hn_rvas.append(sym[key])

    for i, rva in enumerate(k32_hn_rvas):
        struct.pack_into("<Q", buf, k32_ilt_off + i * 8, rva)
        struct.pack_into("<Q", buf, k32_iat_off + i * 8, rva)
    for i, rva in enumerate(u32_hn_rvas):
        struct.pack_into("<Q", buf, u32_ilt_off + i * 8, rva)
        struct.pack_into("<Q", buf, u32_iat_off + i * 8, rva)

    struct.pack_into("<IIIII", buf, idt_off, rdata_rva + k32_ilt_off, 0, 0, sym["dll_kernel32"], rdata_rva + k32_iat_off)
    struct.pack_into("<IIIII", buf, idt_off + 20, rdata_rva + u32_ilt_off, 0, 0, sym["dll_user32"], rdata_rva + u32_iat_off)

    return bytes(buf), sym


def assemble_text(text_rva: int, data_rva: int, sym: dict[str, int]) -> bytes:
    DATA_EXE_PATH = data_rva + 0x000      # 1040 bytes (520 wchar_t)
    DATA_STARTUP = data_rva + 0x420       # 104 bytes STARTUPINFOW
    DATA_PROCINFO = data_rva + 0x4A0      # 24 bytes PROCESS_INFORMATION
    DATA_EXITCODE = data_rva + 0x4C0      # 4 bytes DWORD
    DATA_CMD_BUF = data_rva + 0x500       # up to 32 KB mutable UTF-16LE command buffer

    equs = [
        f".set D_EXE_PATH, _start + {DATA_EXE_PATH - text_rva}",
        f".set D_STARTUP, _start + {DATA_STARTUP - text_rva}",
        f".set D_PROCINFO, _start + {DATA_PROCINFO - text_rva}",
        f".set D_EXITCODE, _start + {DATA_EXITCODE - text_rva}",
        f".set D_CMD_BUF, _start + {DATA_CMD_BUF - text_rva}",
    ]
    for k, v in sym.items():
        equs.append(f".set {k}, _start + {v - text_rva}")

    asm = ".intel_syntax noprefix\n.text\n.globl _start\n_start:\n" + "\n".join(equs) + r"""
    sub rsp, 168

    # 1. Resolve current executable folder and chdir into it
    xor rcx, rcx
    lea rdx, [rip + D_EXE_PATH]
    mov r8d, 512
    call qword ptr [rip + iat_GetModuleFileNameW]

    lea rsi, [rip + D_EXE_PATH]
    mov rdi, rsi
    xor rbx, rbx
scan_slash:
    mov ax, word ptr [rdi]
    test ax, ax
    jz done_slash
    cmp ax, 0x005C
    jne next_char
    mov rbx, rdi
next_char:
    add rdi, 2
    jmp scan_slash
done_slash:
    test rbx, rbx
    jz skip_chdir
    mov word ptr [rbx], 0
    mov rcx, rsi
    call qword ptr [rip + iat_SetCurrentDirectoryW]
skip_chdir:

    # 2. Copy embedded PowerShell installer command into mutable D_CMD_BUF
    lea rsi, [rip + cmd_embedded_setup]
    lea rdi, [rip + D_CMD_BUF]
    mov r12, rdi
copy_cmd:
    mov ax, word ptr [rsi]
    mov word ptr [rdi], ax
    add rsi, 2
    add rdi, 2
    test ax, ax
    jnz copy_cmd

    # 3. CreateProcessW(NULL, D_CMD_BUF, ..., &si, &pi)
    lea r13, [rip + D_STARTUP]
    mov dword ptr [r13], 104
    lea r14, [rip + D_PROCINFO]

    xor rcx, rcx
    mov rdx, r12
    xor r8, r8
    xor r9, r9
    mov qword ptr [rsp + 32], 0
    mov qword ptr [rsp + 40], 0
    mov qword ptr [rsp + 48], 0
    mov qword ptr [rsp + 56], 0
    mov qword ptr [rsp + 64], r13
    mov qword ptr [rsp + 72], r14
    call qword ptr [rip + iat_CreateProcessW]
    test eax, eax
    jz show_missing_box

    mov rcx, qword ptr [r14]
    mov edx, -1
    call qword ptr [rip + iat_WaitForSingleObject]

    mov rcx, qword ptr [r14]
    lea rdx, [rip + D_EXITCODE]
    call qword ptr [rip + iat_GetExitCodeProcess]

    mov rcx, qword ptr [r14]
    call qword ptr [rip + iat_CloseHandle]
    mov rcx, qword ptr [r14 + 8]
    call qword ptr [rip + iat_CloseHandle]

    lea rax, [rip + D_EXITCODE]
    mov ecx, dword ptr [rax]
    call qword ptr [rip + iat_ExitProcess]

show_missing_box:
    xor rcx, rcx
    lea rdx, [rip + str_err_msg]
    lea r8, [rip + str_err_title]
    mov r9d, 0x40
    call qword ptr [rip + iat_MessageBoxW]
    mov ecx, 1
    call qword ptr [rip + iat_ExitProcess]
"""

    with tempfile.TemporaryDirectory() as tmp:
        s_path = os.path.join(tmp, "entry.s")
        o_path = os.path.join(tmp, "entry.o")
        b_path = os.path.join(tmp, "entry.bin")
        with open(s_path, "w", encoding="utf-8") as f:
            f.write(asm)
        subprocess.run(["/usr/bin/as", "--64", s_path, "-o", o_path], check=True)
        subprocess.run(["/usr/bin/objcopy", "-O", "binary", "-j", ".text", o_path, b_path], check=True)
        with open(b_path, "rb") as f:
            return f.read()


def build_setup_exe(output_path: Path):
    SECT_ALIGN = 0x1000
    FILE_ALIGN = 0x200

    TEXT_RVA = 0x1000
    RDATA_RVA = 0x2000

    rdata_bytes, sym = build_rdata(RDATA_RVA)
    rdata_span = align_up(len(rdata_bytes), SECT_ALIGN)

    DATA_RVA = RDATA_RVA + rdata_span
    DATA_VSIZE = 0x11000  # 68 KB scratch space for path, structs, mutable UTF-16LE command line
    RSRC_RVA = DATA_RVA + align_up(DATA_VSIZE, SECT_ALIGN)

    text_bytes = assemble_text(TEXT_RVA, DATA_RVA, sym)
    assert len(text_bytes) <= 0x1000, f".text exceeded 4KB ({len(text_bytes)})"

    icons = [
        (48, 32, make_png_rgba(48)),
        (32, 32, make_bmp_icon_32(32)),
        (16, 32, make_png_rgba(16)),
    ]
    rsrc_bytes = build_rsrc_section(RSRC_RVA, icons)

    dos = bytearray(0x80)
    dos[0:2] = b"MZ"
    struct.pack_into("<H", dos, 0x02, 0x90)
    struct.pack_into("<H", dos, 0x04, 3)
    struct.pack_into("<H", dos, 0x08, 4)
    struct.pack_into("<H", dos, 0x0C, 0xFFFF)
    struct.pack_into("<H", dos, 0x10, 0xB8)
    struct.pack_into("<H", dos, 0x18, 0x40)
    struct.pack_into("<I", dos, 0x3C, 0x80)
    stub_code = (
        b"\x0e\x1f\xba\x0e\x00\xb4\x09\xcd\x21\xb8\x01\x4c\xcd\x21"
        + b"This program requires Windows.\r\n$"
    )
    dos[0x40:0x40 + len(stub_code)] = stub_code

    num_sections = 4
    headers_raw_size = align_up(0x80 + 4 + 20 + 240 + num_sections * 40, FILE_ALIGN)

    text_raw = align_up(len(text_bytes), FILE_ALIGN)
    rdata_raw = align_up(len(rdata_bytes), FILE_ALIGN)
    data_raw = FILE_ALIGN
    rsrc_raw = align_up(len(rsrc_bytes), FILE_ALIGN)

    text_ptr = headers_raw_size
    rdata_ptr = text_ptr + text_raw
    data_ptr = rdata_ptr + rdata_raw
    rsrc_ptr = data_ptr + data_raw

    rsrc_vsize = len(rsrc_bytes)
    size_of_image = align_up(RSRC_RVA + rsrc_vsize, SECT_ALIGN)

    coff = b"PE\0\0" + struct.pack("<HHIIIHH", 0x8664, num_sections, 0, 0, 0, 240, 0x0022)

    opt = bytearray(240)
    struct.pack_into(
        "<HBBIIIIIQIIHHHHHHIIIIHHQQQQII",
        opt,
        0,
        0x020B,
        14, 0,
        text_raw,
        rdata_raw + data_raw + rsrc_raw,
        0,
        TEXT_RVA,
        TEXT_RVA,
        0x0000000140000000,
        SECT_ALIGN,
        FILE_ALIGN,
        6, 0,
        1, 0,
        6, 0,
        0,
        size_of_image,
        headers_raw_size,
        0,
        3,
        0x8100,
        0x100000, 0x1000,
        0x100000, 0x1000,
        0,
        16,
    )

    struct.pack_into("<II", opt, 112 + 1 * 8, sym["import_dir"], 60)
    struct.pack_into("<II", opt, 112 + 2 * 8, RSRC_RVA, rsrc_vsize)
    struct.pack_into("<II", opt, 112 + 12 * 8, sym["iat_start"], sym["iat_end"] - sym["iat_start"])

    def sect_hdr(name: bytes, vsize: int, vaddr: int, rawsize: int, rawptr: int, chars: int) -> bytes:
        return struct.pack("<8sIIIIIIHHI", name.ljust(8, b"\0"), vsize, vaddr, rawsize, rawptr, 0, 0, 0, 0, chars)

    secs = b"".join([
        sect_hdr(b".text", len(text_bytes), TEXT_RVA, text_raw, text_ptr, 0x60000020),
        sect_hdr(b".rdata", len(rdata_bytes), RDATA_RVA, rdata_raw, rdata_ptr, 0x40000040),
        sect_hdr(b".data", DATA_VSIZE, DATA_RVA, data_raw, data_ptr, 0xC0000040),
        sect_hdr(b".rsrc", rsrc_vsize, RSRC_RVA, rsrc_raw, rsrc_ptr, 0x40000040),
    ])

    image = bytearray(rsrc_ptr + rsrc_raw)
    image[0:0x80] = dos
    hdr = coff + bytes(opt) + secs
    image[0x80:0x80 + len(hdr)] = hdr
    image[text_ptr:text_ptr + len(text_bytes)] = text_bytes
    image[rdata_ptr:rdata_ptr + len(rdata_bytes)] = rdata_bytes
    image[rsrc_ptr:rsrc_ptr + len(rsrc_bytes)] = rsrc_bytes

    output_path.write_bytes(bytes(image))
    print(f"Built standalone {output_path} ({len(image)} bytes, .text={len(text_bytes)}B, .rdata={len(rdata_bytes)}B, .rsrc={rsrc_vsize}B)")


if __name__ == "__main__":
    root_dir = Path(__file__).resolve().parent.parent
    build_setup_exe(root_dir / "setup.exe")
