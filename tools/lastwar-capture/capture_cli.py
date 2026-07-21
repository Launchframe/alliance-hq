#!/usr/bin/env python3
"""
CLI capture for Mac + BlueStacks (GPLv3 — see NOTICE / LICENSE).

Usage (Mac):
  cd tools/lastwar-capture
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  sudo -E .venv/bin/python capture_cli.py --list-ifaces
  sudo -E .venv/bin/python capture_cli.py --out ./creds \\
      --api-key \"$LWT_API_KEY\"
  # Then force-quit Last War in BlueStacks, re-launch, log in.
"""

from __future__ import annotations

import argparse
import os
import sys

from capture_core import (
    API_BASE_URL,
    LoginCapture,
    SCAPY_AVAILABLE,
    list_interfaces,
    load_credentials_dir,
    pick_default_iface,
    upload_credentials,
    validate_api_key,
)


def cmd_list_ifaces(_args: argparse.Namespace) -> int:
    if not SCAPY_AVAILABLE:
        print("scapy not installed", file=sys.stderr)
        return 1
    ifaces = list_interfaces()
    if not ifaces:
        print("No usable interfaces (need libpcap + non-loopback IPv4).", file=sys.stderr)
        return 1
    print("name\taddr\tbluestacks_hint")
    for iface in ifaces:
        hint = "yes" if iface.bluestacks_hint else ""
        print(f"{iface.name}\t{iface.addr}\t{hint}")
    default = pick_default_iface(ifaces)
    if default:
        print(f"\nSuggested default: {default.name} ({default.addr})")
    return 0


def cmd_capture(args: argparse.Namespace) -> int:
    ifaces = list_interfaces()
    iface_name = args.iface
    if not iface_name:
        picked = pick_default_iface(ifaces)
        if not picked:
            print("No interface found. Pass --iface explicitly.", file=sys.stderr)
            return 1
        iface_name = picked.name
        print(f"Using interface {iface_name} ({picked.addr})")

    api_key = args.api_key or os.environ.get("LWT_API_KEY", "").strip()
    if api_key:
        ok, label = validate_api_key(api_key, args.api_base)
        if not ok:
            print(f"API key invalid: {label}", file=sys.stderr)
            return 1
        print(f"API key OK ({label})")

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    capturer = LoginCapture(
        iface=iface_name,
        bpf_filter=args.filter,
    )
    try:
        result = capturer.run(timeout_sec=args.timeout)
    except PermissionError as e:
        print(str(e), file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Capture failed: {e}", file=sys.stderr)
        return 1

    if not result:
        print(
            "No credential set captured.\n"
            "Checklist:\n"
            "  1) Run this CLI with sudo\n"
            "  2) Start capture BEFORE launching the game\n"
            "  3) Force-quit Last War in BlueStacks, then open + log in\n"
            "  4) Try --iface en0 (or another iface from --list-ifaces)\n"
            "  5) Fallback: Frida path in README (frida_capture_bluestacks.js)",
            file=sys.stderr,
        )
        return 2

    paths = result.write(out_dir)
    print("Wrote:")
    for path in paths:
        print(f"  {path}")

    if api_key:
        ok, message, body = upload_credentials(result, api_key, base_url=args.api_base)
        if not ok:
            print(f"Upload failed: {message}", file=sys.stderr)
            return 3
        print(f"Upload OK: {message}")
        if body:
            print(f"Response keys: {sorted(body.keys())}")
        print(
            "Next: GET /auth/sessions for session_key, then:\n"
            "  node scripts/lastwar-tools/fetch-vs-daily.mjs --day 1 --alliance-tag YOURTAG"
        )
    else:
        print(
            "Saved locally only. Upload with:\n"
            f"  python capture_cli.py upload --dir {out_dir} --api-key \"$LWT_API_KEY\""
        )
    return 0


def cmd_upload(args: argparse.Namespace) -> int:
    api_key = args.api_key or os.environ.get("LWT_API_KEY", "").strip()
    if not api_key:
        print("Need --api-key or LWT_API_KEY", file=sys.stderr)
        return 1
    creds = load_credentials_dir(args.dir)
    ok, message, body = upload_credentials(creds, api_key, base_url=args.api_base)
    if not ok:
        print(f"Upload failed: {message}", file=sys.stderr)
        return 3
    print(f"Upload OK: {message}")
    if body:
        print(body)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Capture Last War login packets from BlueStacks/Mac traffic"
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("LWT_API_BASE", API_BASE_URL),
        help="lastwar.tools API base URL",
    )
    sub = parser.add_subparsers(dest="cmd")

    p_list = sub.add_parser("list-ifaces", help="List sniffable interfaces")
    p_list.set_defaults(func=cmd_list_ifaces)

    p_cap = sub.add_parser("capture", help="Sniff handshake/auth/login (default)")
    p_cap.add_argument("--iface", help="Interface name (default: BlueStacks-ish guess)")
    p_cap.add_argument(
        "--filter",
        default="tcp",
        help='BPF filter (default "tcp"; try "tcp port 18349")',
    )
    p_cap.add_argument("--out", default="./lastwar-creds", help="Output directory")
    p_cap.add_argument("--api-key", help="Upload immediately when capture completes")
    p_cap.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Seconds to wait before giving up (default: until Ctrl+C / complete)",
    )
    p_cap.set_defaults(func=cmd_capture)

    p_up = sub.add_parser("upload", help="Upload a saved credential directory")
    p_up.add_argument("--dir", required=True, help="Directory with handshake/auth/login.bin")
    p_up.add_argument("--api-key", help="Or set LWT_API_KEY")
    p_up.set_defaults(func=cmd_upload)

    if argv is None:
        argv = sys.argv[1:]
    # Convenience aliases
    if argv == ["--list-ifaces"] or argv[:1] == ["--list-ifaces"]:
        argv = ["list-ifaces", *argv[1:]]
    elif not argv or argv[0].startswith("-"):
        argv = ["capture", *argv]

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
