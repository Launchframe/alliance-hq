#!/usr/bin/env python3
"""
Shared Last War login-packet capture (SmartFox e405/e406 over TCP).

Derivative of LastWarTools/Capture-Tool — see NOTICE / LICENSE (GPLv3).

BlueStacks on Mac uses the same mobile client protocol (typically e405) and
talks to the same relay/game hosts on TCP ~18349. Host-side scapy sniffing
sees that traffic when the emulator NATs through the Mac.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Iterable, Optional

try:
    from scapy.all import (  # type: ignore
        IP,
        Raw,
        TCP,
        conf,
        get_if_addr,
        get_if_list,
        sniff,
    )

    conf.use_pcap = True
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False

API_BASE_URL = os.environ.get("LWT_API_BASE", "https://api.lastwar.tools")
DEFAULT_RELAY_IP = "172.65.210.24"
DEFAULT_GAME_PORT = 18349

E405_HEADER = b"\xe4\x05"
E406_HEADER = b"\xe4\x06"
E407_HEADER = b"\xe4\x07"
C405_HEADER = b"\xc4\x05"
C406_HEADER = b"\xc4\x06"
C407_HEADER = b"\xc4\x07"

PROTOCOL_HEADERS = (
    E405_HEADER,
    E406_HEADER,
    E407_HEADER,
    C405_HEADER,
    C406_HEADER,
    C407_HEADER,
)
GAME_HEADERS = (E405_HEADER, E406_HEADER, E407_HEADER)

MIN_HANDSHAKE_SIZE = 300
MAX_HANDSHAKE_SIZE = 5000
MIN_AUTH_SIZE = 200
MAX_AUTH_SIZE = 5000
MIN_LOGIN_SIZE = 300
MAX_LOGIN_SIZE = 5000

LogFn = Callable[[str], None]


def is_private_ip(ip: str) -> bool:
    if not ip:
        return True
    parts = ip.split(".")
    if len(parts) != 4:
        return True
    try:
        first, second = int(parts[0]), int(parts[1])
    except ValueError:
        return True
    if first == 10:
        return True
    if first == 172 and 16 <= second <= 31:
        return True
    if first == 192 and second == 168:
        return True
    if first == 127:
        return True
    return False


@dataclass(frozen=True)
class NetInterface:
    name: str
    addr: str
    friendly: str
    bluestacks_hint: bool = False


def _iface_bluestacks_score(name: str, friendly: str, addr: str) -> int:
    """Higher = more likely to see BlueStacks NAT / bridge traffic on Mac."""
    blob = f"{name} {friendly}".lower()
    score = 0
    for token in (
        "bluestacks",
        "bst",
        "android",
        "bridge",
        "vnic",
        "vmnet",
        "virtio",
        "hyperkit",
        "utm",
    ):
        if token in blob:
            score += 10
    # Primary Mac Wi-Fi / Ethernet — BlueStacks often NATs out here.
    if name in ("en0", "en1") or friendly.lower() in ("en0", "en1"):
        score += 5
    if addr.startswith("192.168.") or addr.startswith("10."):
        score += 2
    if "utun" in blob or "awdl" in blob or "llw" in blob:
        score -= 5
    # Lab VMs / containers — never prefer these for BlueStacks capture.
    if "docker" in blob or "veth" in blob or "br-" in name:
        score -= 20
    return score


def list_interfaces() -> list[NetInterface]:
    if not SCAPY_AVAILABLE:
        return []
    out: list[NetInterface] = []
    for iface in get_if_list():
        try:
            addr = get_if_addr(iface)
        except Exception:
            continue
        if not addr or addr in ("0.0.0.0", "127.0.0.1") or addr.startswith("169.254"):
            continue
        score = _iface_bluestacks_score(iface, iface, addr)
        out.append(
            NetInterface(
                name=iface,
                addr=addr,
                friendly=iface,
                bluestacks_hint=score >= 5,
            )
        )
    out.sort(key=lambda i: (-_iface_bluestacks_score(i.name, i.friendly, i.addr), i.name))
    return out


@dataclass
class CredentialSet:
    handshake: bytes
    auth: bytes
    login: bytes
    server_ip: str
    server_port: int
    protocol: str

    def write(self, folder: str) -> list[str]:
        os.makedirs(folder, exist_ok=True)
        paths = []
        for name, data in (
            ("handshake.bin", self.handshake),
            ("auth.bin", self.auth),
            ("login.bin", self.login),
        ):
            path = os.path.join(folder, name)
            with open(path, "wb") as f:
                f.write(data)
            paths.append(path)
        meta = os.path.join(folder, "server_info.txt")
        with open(meta, "w", encoding="utf-8") as f:
            f.write(f"server_ip={self.server_ip}\n")
            f.write(f"server_port={self.server_port}\n")
            f.write(f"protocol={self.protocol}\n")
            f.write(f"captured_at={datetime.now().isoformat()}\n")
        paths.append(meta)
        return paths


@dataclass
class CaptureState:
    handshake: Optional[bytes] = None
    auth: Optional[bytes] = None
    login: Optional[bytes] = None
    protocol: Optional[str] = None
    game_server_ip: Optional[str] = None
    game_server_port: Optional[int] = None
    capture_dst_ip: Optional[str] = None
    capture_dst_port: Optional[int] = None
    capture_src_port: Optional[int] = None
    stream_buf: dict = field(default_factory=dict)
    game_pkt_count: int = 0
    packets_scanned: int = 0
    size_warned: set = field(default_factory=set)
    unknown_logged: set = field(default_factory=set)
    failed_handshakes: set = field(default_factory=set)


class LoginCapture:
    """Sniff one login credential triple (handshake + auth + login)."""

    def __init__(
        self,
        iface: str,
        log: Optional[LogFn] = None,
        on_progress: Optional[Callable[[str], None]] = None,
        bpf_filter: str = "tcp",
    ):
        if not SCAPY_AVAILABLE:
            raise RuntimeError(
                "scapy/libpcap not available. On Mac: brew install libpcap && "
                "pip install -r requirements.txt (run capture with sudo)."
            )
        self.iface = iface
        self.log = log or (lambda m: print(m, flush=True))
        self.on_progress = on_progress or (lambda _m: None)
        self.bpf_filter = bpf_filter
        self.state = CaptureState()
        self._stop = False
        self.result: Optional[CredentialSet] = None

    def stop(self) -> None:
        self._stop = True

    def run(self, timeout_sec: Optional[float] = None) -> Optional[CredentialSet]:
        self._stop = False
        self.state = CaptureState()
        self.result = None
        started = time.time()
        self.log(f"Listening on {self.iface} filter={self.bpf_filter!r}")
        self.log(
            "Force-quit Last War in BlueStacks, click start HERE, then launch "
            "the game and log in. Looking for e405/e406 TCP blobs (port ~18349)."
        )

        def stop_filter(_pkt) -> bool:
            if self._stop or self.result is not None:
                return True
            if timeout_sec is not None and (time.time() - started) >= timeout_sec:
                self.log(f"Timed out after {timeout_sec:.0f}s")
                return True
            return False

        try:
            sniff(
                iface=self.iface,
                filter=self.bpf_filter,
                prn=self._handle,
                store=False,
                stop_filter=stop_filter,
            )
        except PermissionError as e:
            raise PermissionError(
                "Packet capture denied. On Mac run with sudo, or grant bpf access."
            ) from e

        return self.result

    def _handle(self, pkt) -> None:
        if self._stop or self.result is not None:
            return
        if TCP not in pkt or Raw not in pkt or IP not in pkt:
            return

        st = self.state
        st.packets_scanned += 1
        if st.packets_scanned % 200 == 0:
            self.on_progress(f"Packets scanned: {st.packets_scanned}")

        src_ip = pkt[IP].src
        dst_ip = pkt[IP].dst
        sport = pkt[TCP].sport
        dport = pkt[TCP].dport
        data = bytes(pkt[Raw].load)
        header = data[:2] if len(data) >= 2 else b""
        is_protocol_packet = header in PROTOCOL_HEADERS
        is_game_packet = header in GAME_HEADERS

        if (
            st.handshake is None
            and st.game_pkt_count == 0
            and len(data) >= 200
            and dport > 10000
            and not is_private_ip(dst_ip)
        ):
            log_key = (dst_ip, dport)
            if log_key not in st.unknown_logged:
                st.unknown_logged.add(log_key)
                self.log(
                    f"[?] Large packet to {dst_ip}:{dport}: "
                    f"{len(data)} bytes, header={data[:4].hex()}"
                )

        if is_game_packet:
            st.game_pkt_count += 1
            if st.game_pkt_count == 1:
                self.log(
                    f"First game packet: {header.hex()} to {dst_ip}:{dport}, "
                    f"{len(data)} bytes"
                )
            if st.handshake is None and not (
                MIN_HANDSHAKE_SIZE <= len(data) <= MAX_HANDSHAKE_SIZE
            ):
                if len(data) not in st.size_warned:
                    st.size_warned.add(len(data))
                    self.log(
                        f"[!] Game packet ({header.hex()}) to {dst_ip}:{dport}: "
                        f"{len(data)} bytes outside "
                        f"{MIN_HANDSHAKE_SIZE}-{MAX_HANDSHAKE_SIZE}"
                    )

        # Step 1 — handshake
        if (
            is_game_packet
            and st.handshake is None
            and MIN_HANDSHAKE_SIZE <= len(data) <= MAX_HANDSHAKE_SIZE
        ):
            if hash(data) in st.failed_handshakes:
                self.log(f"Skipping previously failed handshake ({len(data)} bytes)")
                return
            st.protocol = header.hex()
            st.handshake = data
            if is_private_ip(dst_ip):
                st.game_server_ip = DEFAULT_RELAY_IP
                st.game_server_port = dport or DEFAULT_GAME_PORT
                self.log(
                    f"[1] Handshake via proxy {dst_ip}:{dport}: {len(data)} bytes "
                    f"(using public IP {st.game_server_ip})"
                )
            else:
                st.game_server_ip = dst_ip
                st.game_server_port = dport
                self.log(f"[1] Handshake to {dst_ip}:{dport}: {len(data)} bytes")
            st.capture_dst_ip = dst_ip
            st.capture_dst_port = dport
            st.capture_src_port = sport
            self.on_progress(f"Handshake OK ({len(data)}B, {st.protocol})")
            return

        # Steps 2–3 — same TCP stream
        if (
            st.handshake is None
            or st.login is not None
            or not st.capture_src_port
            or sport != st.capture_src_port
            or not st.capture_dst_port
            or dport != st.capture_dst_port
        ):
            return

        key = (src_ip, dst_ip, sport, dport)
        if key not in st.stream_buf:
            st.stream_buf[key] = bytearray()
        st.stream_buf[key].extend(data)
        buf = st.stream_buf[key]

        if st.auth is None and not is_protocol_packet:
            if MIN_AUTH_SIZE <= len(data) <= MAX_AUTH_SIZE:
                sample = data[:100] if len(data) >= 100 else data
                if len(set(sample)) > 50:
                    self.log(f"[2] Auth packet: {len(data)} bytes, header={header.hex()}")
                    st.auth = data
                    st.stream_buf[key] = bytearray()
                    self.on_progress(f"Auth OK ({len(data)}B)")
                    return

        if st.auth is not None and is_game_packet:
            if MIN_LOGIN_SIZE <= len(data) <= MAX_LOGIN_SIZE:
                login_candidate = (
                    bytes(buf)
                    if (
                        len(buf) >= len(data)
                        and buf[:2] in GAME_HEADERS
                    )
                    else data
                )
                self.log(
                    f"[3] Login trigger: {len(login_candidate)} bytes to "
                    f"{dst_ip}:{dport}"
                    + (
                        " (reassembled)"
                        if len(login_candidate) > len(data)
                        else ""
                    )
                )
                st.login = login_candidate
                st.stream_buf[key] = bytearray()
                self._complete()
                return

        for i in range(1, len(buf) - 1):
            if buf[i] == 0xE4 and buf[i + 1] in (0x05, 0x06, 0x07):
                auth_candidate = bytes(buf[:i])
                login_candidate = bytes(buf[i:])
                if (
                    st.auth is None
                    and MIN_AUTH_SIZE <= len(auth_candidate) <= MAX_AUTH_SIZE
                ):
                    sample = auth_candidate[:100]
                    if len(set(sample)) > 50:
                        self.log(
                            f"[2] Auth packet: {len(auth_candidate)} bytes (reassembled)"
                        )
                        st.auth = auth_candidate
                        self.on_progress(f"Auth OK ({len(auth_candidate)}B)")
                if (
                    st.auth is not None
                    and st.login is None
                    and login_candidate[:2] in GAME_HEADERS
                    and MIN_LOGIN_SIZE <= len(login_candidate) <= MAX_LOGIN_SIZE
                ):
                    self.log(
                        f"[3] Login trigger: {len(login_candidate)} bytes (reassembled)"
                    )
                    st.login = login_candidate
                    self._complete()
                buf.clear()
                break

    def _complete(self) -> None:
        st = self.state
        if not (st.handshake and st.auth and st.login and st.game_server_ip and st.game_server_port and st.protocol):
            return
        self.result = CredentialSet(
            handshake=st.handshake,
            auth=st.auth,
            login=st.login,
            server_ip=st.game_server_ip,
            server_port=st.game_server_port,
            protocol=st.protocol,
        )
        self.on_progress("Capture complete")
        self.log(
            f"Complete: server={self.result.server_ip}:{self.result.server_port} "
            f"handshake={len(self.result.handshake)}B "
            f"auth={len(self.result.auth)}B "
            f"login={len(self.result.login)}B "
            f"protocol={self.result.protocol}"
        )
        self._stop = True


def _http_json(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    body: Optional[bytes] = None,
    timeout: float = 30,
) -> tuple[int, str, dict]:
    """Minimal HTTP helper (stdlib only — no requests dependency)."""
    import json
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, data=body, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = getattr(resp, "status", 200) or 200
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except urllib.error.URLError as e:
        return 0, str(e.reason or e), {}

    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {"data": parsed}
    return status, raw, parsed


def _multipart_form(files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    """Build multipart/form-data body. files: field -> (filename, data, content_type)."""
    import uuid

    boundary = f"----LastWarCapture{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for field, (filename, data, content_type) in files.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{field}"; '
                f'filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
        )
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def upload_credentials(
    creds: CredentialSet,
    api_key: str,
    base_url: str = API_BASE_URL,
    timeout: float = 30,
) -> tuple[bool, str, dict]:
    import urllib.parse

    files = {
        "handshake": ("handshake.bin", creds.handshake, "application/octet-stream"),
        "auth_packet": ("auth.bin", creds.auth, "application/octet-stream"),
        "login": ("login.bin", creds.login, "application/octet-stream"),
    }
    params = {}
    if creds.server_ip and not is_private_ip(creds.server_ip):
        params["server_ip"] = creds.server_ip
        params["server_port"] = str(creds.server_port)

    body, content_type = _multipart_form(files)
    url = f"{base_url.rstrip('/')}/auth/credentials/upload"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    status, raw, parsed = _http_json(
        "POST",
        url,
        headers={"X-API-Key": api_key, "Content-Type": content_type},
        body=body,
        timeout=timeout,
    )
    if 200 <= status < 300:
        return True, parsed.get("message", "uploaded"), parsed

    detail = parsed.get("detail", raw)
    if isinstance(detail, dict):
        detail = detail.get("validation_error") or detail.get("message") or detail
    return False, f"HTTP {status}: {detail}", parsed


def validate_api_key(api_key: str, base_url: str = API_BASE_URL) -> tuple[bool, str]:
    status, raw, parsed = _http_json(
        "GET",
        f"{base_url.rstrip('/')}/auth/validate",
        headers={"X-API-Key": api_key, "Accept": "application/json"},
        timeout=10,
    )
    if status == 0:
        return False, raw or "network error"
    if not (200 <= status < 300):
        return False, f"HTTP {status}"
    return True, parsed.get("display_name") or "ok"


def load_credentials_dir(folder: str) -> CredentialSet:
    def read(name: str) -> bytes:
        with open(os.path.join(folder, name), "rb") as f:
            return f.read()

    server_ip = DEFAULT_RELAY_IP
    server_port = DEFAULT_GAME_PORT
    protocol = "unknown"
    meta = os.path.join(folder, "server_info.txt")
    if os.path.isfile(meta):
        with open(meta, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("server_ip="):
                    server_ip = line.split("=", 1)[1]
                elif line.startswith("server_port="):
                    server_port = int(line.split("=", 1)[1])
                elif line.startswith("protocol="):
                    protocol = line.split("=", 1)[1]
    return CredentialSet(
        handshake=read("handshake.bin"),
        auth=read("auth.bin"),
        login=read("login.bin"),
        server_ip=server_ip,
        server_port=server_port,
        protocol=protocol,
    )


def pick_default_iface(interfaces: Iterable[NetInterface]) -> Optional[NetInterface]:
    ifaces = list(interfaces)
    if not ifaces:
        return None
    hinted = [i for i in ifaces if i.bluestacks_hint]
    return hinted[0] if hinted else ifaces[0]
