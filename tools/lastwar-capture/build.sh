#!/bin/bash
# Build LastWarCapture binary (Mac/Linux). Prefer the CLI for BlueStacks labs.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null; then
  echo "ERROR: Python 3 not found"
  exit 1
fi

python3 -m pip install -r requirements-build.txt

echo "Building GUI executable (optional)..."
pyinstaller --onefile \
  --windowed \
  --name "LastWarCapture" \
  --hidden-import=scapy.layers.all \
  lastwar_capture.py

echo ""
echo "GUI binary: dist/LastWarCapture"
echo "For BlueStacks on Mac, the CLI is usually easier:"
echo "  sudo -E python3 capture_cli.py capture --out ./creds --api-key \"\$LWT_API_KEY\""
