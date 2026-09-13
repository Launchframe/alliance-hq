import hashlib
import json
from pathlib import Path
import tarfile

from .bootstrap import digest_file
from .engine import verify_trained_model


def pack_model(root: Path, manifest_hash: str, output: Path, max_bytes: int):
    verify_trained_model(root, manifest_hash)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    names = sorted(["manifest.json", *manifest["files"]])
    blocks = 2 + sum(1 + ((root / name).stat().st_size + 511) // 512 for name in names)
    expected_bytes = ((blocks * 512 + tarfile.RECORDSIZE - 1) // tarfile.RECORDSIZE) * tarfile.RECORDSIZE
    if expected_bytes > max_bytes:
        raise ValueError("model_artifact_limit")
    with output.open("xb") as target, tarfile.open(fileobj=target, mode="w", format=tarfile.USTAR_FORMAT) as bundle:
        for name in names:
            entry = tarfile.TarInfo(name)
            entry.size = (root / name).stat().st_size
            entry.mode = 0o600
            with (root / name).open("rb") as data:
                bundle.addfile(entry, data)
    size = output.stat().st_size
    if size > max_bytes:
        raise ValueError("model_artifact_limit")
    return {"sha256": digest_file(output), "bytes": size, "manifestText": (root / "manifest.json").read_text(encoding="utf-8")}


def unpack_model(archive: Path, root: Path, archive_hash: str, manifest_hash: str, max_bytes: int):
    if archive.is_symlink() or archive.stat().st_size > max_bytes or digest_file(archive) != archive_hash:
        raise ValueError("model_digest_mismatch")
    allowed = {"manifest.json", "inference.json", "inference.pdmodel", "inference.pdiparams", "inference.pdiparams.info", "inference.yml"}
    seen = set()
    with archive.open("rb") as source:
        while header := source.read(512):
            if header == bytes(512):
                break
            member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
            if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) or member.name not in allowed or member.name in seen or member.size < 0 or member.size > max_bytes or len(seen) >= 6:
                raise ValueError("unsafe_model_archive")
            seen.add(member.name)
            source.seek(((member.size + 511) // 512) * 512, 1)
            if source.tell() > archive.stat().st_size:
                raise ValueError("unsafe_model_archive")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    with tarfile.open(archive, mode="r:") as bundle:
        members = bundle.getmembers()
        names = [member.name for member in members]
        if not 3 <= len(members) <= 6 or len(set(names)) != len(names) or not set(names) <= allowed or sum(member.size for member in members) > max_bytes:
            raise ValueError("unsafe_model_archive")
        if "manifest.json" not in names:
            raise ValueError("invalid_model_manifest")
        manifest_member = bundle.getmember("manifest.json")
        if not manifest_member.isfile() or manifest_member.size > 1024 ** 2:
            raise ValueError("invalid_model_manifest")
        manifest_stream = bundle.extractfile(manifest_member)
        if manifest_stream is None:
            raise ValueError("invalid_model_manifest")
        if hashlib.sha256(manifest_stream.read()).hexdigest() != manifest_hash:
            raise ValueError("model_digest_mismatch")
        for member in members:
            if not member.isfile():
                raise ValueError("unsafe_model_archive")
            source = bundle.extractfile(member)
            if source is None:
                raise ValueError("unsafe_model_archive")
            with (root / member.name).open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
    verify_trained_model(root, manifest_hash)
    return root
