import hashlib
from pathlib import Path

FILES = ("__init__.py", "__main__.py", "bootstrap.py", "build.py", "contracts.py", "engine.py", "execute.py", "files.py", "inference.py", "rows.py", "sampling.py", "training.py")


def worker_code_hash():
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in FILES:
        digest.update(name.encode("ascii") + b"\0" + (root / name).read_bytes())
    digest.update(b"uv.lock\0" + (root.parent / "uv.lock").read_bytes())
    return digest.hexdigest()
