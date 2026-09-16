# Last War capture — Mac + BlueStacks

GPLv3 derivative of [LastWarTools/Capture-Tool](https://github.com/LastWarTools/Capture-Tool).  
**Standalone lab tool** — do not import into the Alliance HQ Next.js app (see `NOTICE`).

## What it captures

Not HTTPS. The game login is **raw TCP** SmartFox blobs to the relay/game host (often `172.65.210.24:18349`):

| File | Shape |
|------|--------|
| `handshake.bin` | First `e405` / `e406` packet (~300–5000 B). **Mobile/BlueStacks is usually `e405`.** |
| `auth.bin` | High-entropy non-protocol packet on the **same TCP stream** |
| `login.bin` | Second `e405` / `e406` on that stream (login trigger; often `4505` vs handshake `4507`) |

That is exactly what `POST https://api.lastwar.tools/auth/credentials/upload` expects.

BlueStacks runs the Android client; the **wire shape is the same**. Host-side scapy on your Mac can see the NAT’d packets if you sniff the right interface (usually `en0`).

## Where to run this

| Machine | Can capture BlueStacks login? |
|---------|-------------------------------|
| **Your Mac** (BlueStacks installed) | **Yes** — run capture here |
| Cursor cloud agent (`/workspace` on Linux) | **No** — no BlueStacks, no `en0`; only good for editing/scripts |

If your prompt shows `/workspace/tools/lastwar-capture` and `ubuntu@…`, you are on the **cloud agent**. Finish setup with `./setup.sh` if you want, but run **capture on the Mac**.

## Mac setup

```bash
# once, ON YOUR MAC, from the repo checkout
xcode-select --install   # if needed
brew install libpcap
cd tools/lastwar-capture
./setup.sh               # creates .venv + installs scapy
source .venv/bin/activate
export LWT_API_KEY='…'
```

### Dependency loop / broken `.venv`

Symptoms:

- `ensurepip is not available` / `apt install python3-venv`
- `bash: python: command not found` (Debian has `python3` only)
- CLI says install scapy into `.venv/bin/python` but that venv has no `pip`

Fix:

```bash
cd /path/to/repo/tools/lastwar-capture   # don't nest cd tools/… if already here
rm -rf .venv
./setup.sh
# or manually:
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Never use bare `pip` (it often installs to `~/.local` while you run `.venv/bin/python`).  
Always: `.venv/bin/python -m pip install …`

`requests` is **not** required (upload uses stdlib). Only `scapy` is.

Packet capture needs root / BPF:

```bash
sudo -E .venv/bin/python capture_cli.py list-ifaces
sudo -E .venv/bin/python capture_cli.py capture \
  --iface en0 \
  --out ./creds \
  --api-key "$LWT_API_KEY"
```

### Capture sequence

1. **Force-quit** Last War inside BlueStacks (not just Home).
2. **Start** the CLI/GUI capture.
3. Launch Last War in BlueStacks and log in.
4. Wait for handshake → auth → login; tool uploads when `--api-key` is set.
5. `GET /auth/sessions` (or use `scripts/lastwar-tools/fetch-vs-daily.mjs`) for a `session_key`.

### If no packets

- Wrong iface → try every ★ / `en0` / `bridge*` from `list-ifaces`
- Capture started after login → force-quit and retry
- BlueStacks network mode oddity → reboot BlueStacks, retry on `en0`
- Still stuck → Frida path below (hooks `send()` inside the Android guest)

Optional BPF tighten once you confirm port:

```bash
sudo -E .venv/bin/python capture_cli.py capture --filter "tcp port 18349" --out ./creds
```

## Frida fallback (inside BlueStacks)

When host sniffing is blind, hook the guest:

1. Enable ADB in BlueStacks → Advanced.
2. `adb connect 127.0.0.1:<port>`
3. Run `frida-server` on the device (root/magisk image if required).
4. `frida -H 127.0.0.1:27042 -f com.fun.lastwar.gp -l frida_capture_bluestacks.js`
5. `adb pull` `handshake.bin` / `auth.bin` / `login.bin`
6. Upload:

```bash
python capture_cli.py upload --dir ./pulled --api-key "$LWT_API_KEY"
```

Confirm package id: `adb shell pm list packages | grep -i lastwar`

## After credentials

```bash
# from repo root
export LWT_API_KEY='…'
export LWT_SESSION_KEY='…'          # from GET /auth/sessions
export LWT_ALLIANCE_TAG='YOURTAG'

node scripts/lastwar-tools/fetch-vs-daily.mjs --day 1
# Monday = day 1 … Saturday = day 6
```

## GUI / binary

```bash
./build.sh          # dist/LastWarCapture
# or
python lastwar_capture.py
```

CLI is the supported path for BlueStacks labs.

## License

GNU GPLv3 — see `LICENSE`. Upstream: LastWarTools/Capture-Tool.
