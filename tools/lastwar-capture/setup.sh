#!/usr/bin/env bash
# One-shot env setup for the capture CLI (Linux cloud agent or Mac).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null; then
  echo "python3 not found" >&2
  exit 1
fi

# Broken half-venvs (ensurepip missing) only have symlinks — wipe and redo.
if [[ -d .venv ]] && [[ ! -x .venv/bin/pip && ! -x .venv/bin/pip3 ]]; then
  echo "Removing broken .venv (no pip)…"
  rm -rf .venv
fi

if [[ ! -d .venv ]]; then
  if ! python3 -m venv .venv; then
    echo "" >&2
    echo "python3 -m venv failed." >&2
    echo "  Debian/Ubuntu cloud agent:  sudo apt-get install -y python3-venv python3-pip" >&2
    echo "  Mac:                        keep using Homebrew python3, then retry" >&2
    echo "" >&2
    echo "Fallback without venv:" >&2
    echo "  python3 -m pip install --user -r requirements.txt" >&2
    echo "  python3 capture_cli.py list-ifaces" >&2
    exit 1
  fi
fi

# Always drive pip through the venv python (never bare `pip`).
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install -r requirements.txt

echo ""
echo "OK. Activate and run:"
echo "  source .venv/bin/activate"
echo "  # Mac + BlueStacks (on your Mac):"
echo "  sudo -E .venv/bin/python capture_cli.py capture --iface en0 --out ./creds --api-key \"\$LWT_API_KEY\""
echo ""
echo "  # This Linux cloud agent cannot see BlueStacks — capture must run on your Mac."
.venv/bin/python capture_cli.py list-ifaces || true
