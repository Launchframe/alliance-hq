# Last War Tools — BlueStacks capture on Mac

Operator guide for capturing game login credentials from **BlueStacks on Mac**, uploading them to [api.lastwar.tools](https://api.lastwar.tools), and pulling **VS daily** scores without OCR.

Lab tool source: [`tools/lastwar-capture/`](../../tools/lastwar-capture/) (GPLv3 fork of [LastWarTools/Capture-Tool](https://github.com/LastWarTools/Capture-Tool)).

## Protocol (what “the request” looks like)

Login is **not** HTTPS JSON. The client opens a TCP session to the game relay (commonly `172.65.210.24:18349`) and sends encrypted SmartFox blobs:

1. **Handshake** — first large `e405` / `e406` packet (`e405` = mobile / BlueStacks; `e406` = typical PC)
2. **Auth** — high-entropy packet on the same stream
3. **Login** — second `e405` / `e406` on that stream

Those three binaries are uploaded as `handshake` / `auth_packet` / `login` to `POST /auth/credentials/upload`. The capture tool and BlueStacks traffic must match that shape — they do, because BlueStacks runs the Android client against the same hosts.

## Mac + BlueStacks steps

1. Create a free API key at [lastwar.tools](https://lastwar.tools/).
2. Install lab deps (once):

```bash
brew install libpcap
cd tools/lastwar-capture
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -r requirements.txt   # must match the python that runs the CLI
export LWT_API_KEY='…'
```

3. Force-quit Last War in BlueStacks.
4. Start capture **before** relaunching the game:

```bash
sudo -E .venv/bin/python capture_cli.py list-ifaces
sudo -E .venv/bin/python capture_cli.py capture --iface en0 --out ./creds --api-key "$LWT_API_KEY"
```

5. Launch Last War in BlueStacks and log in. Wait for “Upload OK”.
6. List sessions and fetch Monday VS (day `1`):

```bash
node scripts/lastwar-tools/list-sessions.mjs
export LWT_SESSION_KEY='…'
export LWT_ALLIANCE_TAG='YOURTAG'
node scripts/lastwar-tools/fetch-vs-daily.mjs --day 1
```

UIDs are redacted in the table by default (`--show-uid` only on a private machine).

## Fallback: Frida inside BlueStacks

If host sniffing sees zero `e405` packets, use `tools/lastwar-capture/frida_capture_bluestacks.js` (ADB + frida-server). Details in [`tools/lastwar-capture/README.md`](../../tools/lastwar-capture/README.md).

## Read-only whitelist

Only call read endpoints (`/vs/*`, `/alliance/*/members`, `/auth/*`). Do **not** call `/actions/*` from Alliance HQ automation.

## License boundary

`tools/lastwar-capture/` is GPLv3. Do not import it into the Next.js app. HQ-side Node scripts under `scripts/lastwar-tools/` only talk to the HTTP API.
