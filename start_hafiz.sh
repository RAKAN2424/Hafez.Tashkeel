#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "[Setup] Installing Node.js dependencies..."
  npm install
fi

if [ -x ".venv/bin/python" ]; then
  export PYTHON_BIN="$(pwd)/.venv/bin/python"
  echo "[Python] Using virtual environment: $PYTHON_BIN"
fi

echo "Starting Hafiz Bel'Amya on http://localhost:3000 ..."
(
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:3000" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:3000" || true
  fi
) &

exec npx tsx server.ts
