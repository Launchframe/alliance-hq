#!/usr/bin/env python3
"""
Tk GUI wrapper around capture_core (Mac/Windows).

Derivative of LastWarTools/Capture-Tool — GPLv3 (see NOTICE / LICENSE).
For BlueStacks on Mac, prefer: python capture_cli.py capture ...
"""

from __future__ import annotations

import os
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from capture_core import (
    API_BASE_URL,
    LoginCapture,
    SCAPY_AVAILABLE,
    list_interfaces,
    upload_credentials,
    validate_api_key,
)


class CaptureApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Last War Capture (Mac / BlueStacks)")
        self.root.geometry("520x560")
        self.capturer: LoginCapture | None = None
        self.thread: threading.Thread | None = None
        self.last_creds = None
        self.interfaces = list_interfaces() if SCAPY_AVAILABLE else []
        self._build()

    def _build(self) -> None:
        main = ttk.Frame(self.root, padding=16)
        main.pack(fill=tk.BOTH, expand=True)

        ttk.Label(main, text="Last War Capture", font=("Helvetica", 16, "bold")).pack(
            anchor=tk.W
        )
        ttk.Label(
            main,
            text="Sniffs e405/e406 TCP login blobs (BlueStacks → same shape as PC tool)",
            foreground="#555",
        ).pack(anchor=tk.W, pady=(0, 12))

        key_frame = ttk.LabelFrame(main, text="API key", padding=10)
        key_frame.pack(fill=tk.X, pady=(0, 10))
        self.apikey = ttk.Entry(key_frame, show="•")
        self.apikey.pack(fill=tk.X)
        self.apikey.insert(0, os.environ.get("LWT_API_KEY", ""))

        iface_frame = ttk.LabelFrame(main, text="Interface", padding=10)
        iface_frame.pack(fill=tk.X, pady=(0, 10))
        self.iface_var = tk.StringVar()
        values = [f"{i.name} ({i.addr})" + (" ★" if i.bluestacks_hint else "") for i in self.interfaces]
        self.iface_combo = ttk.Combobox(iface_frame, textvariable=self.iface_var, values=values, state="readonly")
        if values:
            # Prefer ★ / first sorted (BlueStacks-ish)
            self.iface_combo.current(0)
        self.iface_combo.pack(fill=tk.X)

        self.status = ttk.Label(main, text="Ready — force-quit game, Start, then launch + login")
        self.status.pack(anchor=tk.W, pady=(0, 8))
        self.log_box = tk.Text(main, height=14, wrap=tk.WORD)
        self.log_box.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        btns = ttk.Frame(main)
        btns.pack(fill=tk.X)
        self.start_btn = ttk.Button(btns, text="Start Capture", command=self.toggle)
        self.start_btn.pack(side=tk.LEFT)
        ttk.Button(btns, text="Save files…", command=self.save).pack(side=tk.LEFT, padx=8)
        ttk.Label(btns, text=API_BASE_URL, foreground="#888").pack(side=tk.RIGHT)

        if not SCAPY_AVAILABLE:
            self.status.config(text="scapy missing — pip install -r requirements.txt")
            self.start_btn.config(state=tk.DISABLED)

    def log(self, msg: str) -> None:
        self.log_box.insert(tk.END, msg + "\n")
        self.log_box.see(tk.END)

    def toggle(self) -> None:
        if self.capturer:
            self.capturer.stop()
            self.capturer = None
            self.start_btn.config(text="Start Capture")
            self.status.config(text="Stopped")
            return
        idx = self.iface_combo.current()
        if idx < 0 or idx >= len(self.interfaces):
            messagebox.showwarning("Interface", "Select a network interface")
            return
        iface = self.interfaces[idx].name
        api_key = self.apikey.get().strip()
        if api_key:
            ok, label = validate_api_key(api_key)
            if not ok:
                messagebox.showerror("API key", f"Invalid: {label}")
                return
            self.log(f"API key OK ({label})")

        self.capturer = LoginCapture(
            iface=iface,
            log=lambda m: self.root.after(0, lambda: self.log(m)),
            on_progress=lambda m: self.root.after(0, lambda: self.status.config(text=m)),
        )
        self.start_btn.config(text="Stop")
        self.status.config(text="Capturing… open Last War in BlueStacks and log in")

        def run() -> None:
            try:
                result = self.capturer.run() if self.capturer else None
            except PermissionError as e:
                self.root.after(0, lambda: messagebox.showerror("Permission", str(e)))
                self.root.after(0, lambda: self.start_btn.config(text="Start Capture"))
                return
            self.root.after(0, lambda: self._done(result, api_key))

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def _done(self, result, api_key: str) -> None:
        self.capturer = None
        self.start_btn.config(text="Start Capture")
        if not result:
            self.status.config(text="No credentials captured")
            return
        self.last_creds = result
        self.status.config(text="Capture complete")
        if api_key:
            ok, message, _body = upload_credentials(result, api_key)
            if ok:
                self.log(f"Upload OK: {message}")
                messagebox.showinfo("Done", message)
            else:
                self.log(f"Upload failed: {message}")
                messagebox.showerror("Upload", message)

    def save(self) -> None:
        if not self.last_creds:
            messagebox.showinfo("Save", "Nothing captured yet")
            return
        folder = filedialog.askdirectory(title="Save credential files")
        if not folder:
            return
        paths = self.last_creds.write(folder)
        self.log("Saved:\n  " + "\n  ".join(paths))


def main() -> None:
    root = tk.Tk()
    CaptureApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
