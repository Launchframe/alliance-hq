import hashlib
import json
from pathlib import Path
import re
import time

import cv2
from PIL import Image

from .contracts import Frame


def stable_json(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def content_hash(value) -> str:
    return hashlib.sha256(stable_json(value).encode("utf-8")).hexdigest()


def read_json(path: Path, max_bytes=4 * 1024 ** 2):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > max_bytes:
        raise ValueError("invalid_input_file")
    with path.open("r", encoding="utf-8", errors="strict") as source:
        return json.load(source)


def verify_frame(root: Path, frame: Frame) -> Path:
    path = root / f"{frame.sha256}.bin"
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("invalid_frame_path")
    if path.stat().st_size != frame.bytes:
        raise ValueError("frame_size_mismatch")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != frame.sha256:
        raise ValueError("frame_digest_mismatch")
    with Image.open(path) as image:
        if image.size != (frame.width, frame.height) or image.width * image.height > 6_000_000:
            raise ValueError("frame_dimensions_mismatch")
    return path


def load_frame(root: Path, frame: Frame):
    path = verify_frame(root, frame)
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None or image.shape[:2] != (frame.height, frame.width):
        raise ValueError("frame_decode_failed")
    return image


def check_deadline(deadline: float):
    if time.monotonic() >= deadline:
        raise TimeoutError("worker_time_limit")


def normalize_integer(text: str) -> str | None:
    value = text.strip()
    if re.fullmatch(r"\d{1,3}(?:[, .]\d{3})+", value, flags=re.ASCII):
        value = re.sub(r"[, .]", "", value)
    if not re.fullmatch(r"\d+", value, flags=re.ASCII):
        return None
    number = int(value)
    return str(number) if number <= 9_007_199_254_740_991 else None
