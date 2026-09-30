import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile
import time
import urllib.request
import uuid

PADDLEOCR_REVISION = "b03f46425e8ff4442b268ce449e3eef758146cd4"
ASSETS = {
    "detector": {
        "url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_infer.tar",
        "sha256": "50446e5d01ac2a73d5319c89513281f6578414c888c602f9af13f93feefffc58",
        "bytes": 4935680,
        "file": "detector.tar",
        "directory": "PP-OCRv5_mobile_det_infer",
    },
    "recognizer": {
        "url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_infer.tar",
        "sha256": "566b9512b34e34a9f0db54d87b51fa5a0b9ed2cf1ab7e49728cc0b8b5a64f414",
        "bytes": 16834560,
        "file": "recognizer.tar",
        "directory": "PP-OCRv5_mobile_rec_infer",
    },
    "pretrained": {
        "url": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv5_mobile_rec_pretrained.pdparams",
        "sha256": "04745475b97a1faf029c7442a4c4421b156249b9395814e509bf4a9804e37750",
        "bytes": 133890015,
        "file": "recognizer_pretrained.pdparams",
    },
}


def digest_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def download(asset: dict, root: Path) -> Path:
    target = root / asset["file"]
    if target.exists():
        if not target.is_file() or target.is_symlink() or target.stat().st_size != asset["bytes"] or digest_file(target) != asset["sha256"]:
            raise ValueError("model_digest_mismatch")
        return target
    temporary = root / f"{uuid.uuid4().hex}.part"
    deadline = time.monotonic() + 900
    total = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(asset["url"], timeout=60) as response, temporary.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > asset["bytes"] or time.monotonic() > deadline:
                    raise ValueError("model_download_limit")
                digest.update(chunk)
                output.write(chunk)
        if total != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
            raise ValueError("model_digest_mismatch")
        os.link(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def unpack(archive: Path, root: Path, directory: str) -> dict:
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if len(members) > 100 or sum(member.size for member in members) > 256 * 1024 ** 2:
            raise ValueError("model_archive_limit")
        for member in members:
            target = (root / member.name).resolve()
            if not target.is_relative_to(root.resolve()) or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe_model_archive")
            if Path(member.name).parts[0] != directory:
                raise ValueError("unexpected_model_layout")
            if member.isfile() and target.exists():
                source = bundle.extractfile(member)
                if target.is_symlink() or source is None or hashlib.sha256(source.read()).hexdigest() != digest_file(target):
                    raise ValueError("model_digest_mismatch")
        bundle.extractall(root, filter="data")
    return {member.name: digest_file(root / member.name) for member in members if member.isfile()}


def bootstrap(root: Path) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, asset in ASSETS.items():
        archive = download(asset, root)
        files[str(archive.relative_to(root))] = asset["sha256"]
        if "directory" in asset:
            files.update(unpack(archive, root, asset["directory"]))
        print(json.dumps({"asset": name, "verified": True}), flush=True)
    manifest = {"version": 1, "paddleocrRevision": PADDLEOCR_REVISION, "files": files}
    manifest_path = root / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as output:
        json.dump(manifest, output, sort_keys=True, indent=2)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(".runtime/models"))
    args = parser.parse_args()
    bootstrap(args.root)


if __name__ == "__main__":
    main()
