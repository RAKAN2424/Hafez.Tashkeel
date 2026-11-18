#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================================================"
echo "  Hafiz Bel'Amya - Complete Local Backends & Dependencies Installer"
echo "============================================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed. Please install Node.js 20+."
  exit 1
fi

PY_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PY_BIN" >/dev/null 2>&1; then
  echo "[ERROR] Python 3 is not installed. Please install Python 3.10+."
  exit 1
fi

echo "[1/4] Installing Node.js dependencies (npm install)..."
npm install

echo "[2/4] Setting up Python virtual environment (.venv)..."
if [ ! -x ".venv/bin/python" ]; then
  "$PY_BIN" -m venv .venv
fi
VENV_PY=".venv/bin/python"
"$VENV_PY" -m pip install --upgrade pip setuptools wheel

echo "[3/4] Installing Python AI backends from requirements.txt..."
"$VENV_PY" -m pip install -r requirements.txt

echo "[4/4] Installing optional backends (best effort)..."
"$VENV_PY" -m pip install openai-whisper || true
"$VENV_PY" -m pip install TTS || true
"$VENV_PY" -m pip install omnivoice || true

echo "============================================================================"
echo "  Done! Run ./start_hafiz.sh to open Hafiz Bel'Amya."
echo "============================================================================"
