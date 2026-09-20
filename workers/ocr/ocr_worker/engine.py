from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import tarfile

import numpy as np

from .bootstrap import ASSETS, digest_file


@dataclass(frozen=True)
class Cell:
    text: str
    confidence: float
    box: tuple[float, float, float, float]


def verify_official_models(root: Path):
    for key in ("detector", "recognizer"):
        asset = ASSETS[key]
        archive = root / asset["file"]
        if archive.is_symlink() or archive.stat().st_size != asset["bytes"] or digest_file(archive) != asset["sha256"]:
            raise ValueError("model_digest_mismatch")
        with tarfile.open(archive) as bundle:
            for member in bundle.getmembers():
                if not member.isfile():
                    continue
                destination = root / member.name
                if destination.is_symlink() or not destination.resolve().is_relative_to(root.resolve()):
                    raise ValueError("unsafe_model_path")
                stream = bundle.extractfile(member)
                if stream is None or member.size > 256 * 1024 ** 2 or hashlib.sha256(stream.read()).hexdigest() != digest_file(destination):
                    raise ValueError("model_digest_mismatch")


def verify_trained_model(root: Path, expected_hash: str | None):
    manifest = root / "manifest.json"
    if expected_hash is None or not re.fullmatch(r"[a-f0-9]{64}", expected_hash) or manifest.is_symlink() or manifest.stat().st_size > 1024 ** 2:
        raise ValueError("untrusted_model_artifact")
    data = manifest.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("model_digest_mismatch")
    description = json.loads(data)
    files = description["files"]
    allowed = {"inference.json", "inference.pdmodel", "inference.pdiparams", "inference.pdiparams.info", "inference.yml"}
    if description.get("version") != 1 or description.get("family") != "paddle-v5-mobile-rec" or not isinstance(files, dict) or not set(files) <= allowed:
        raise ValueError("invalid_model_manifest")
    if not {"inference.pdiparams", "inference.yml"} <= set(files) or not {"inference.json", "inference.pdmodel"} & set(files):
        raise ValueError("invalid_model_manifest")
    if {path.name for path in root.iterdir()} != set(files) | {"manifest.json"}:
        raise ValueError("model_directory_changed")
    total = 0
    for name, digest in files.items():
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in (".", ".."):
            raise ValueError("unsafe_model_path")
        target = root / name
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(root.resolve()):
            raise ValueError("unsafe_model_path")
        total += target.stat().st_size
        if total > 256 * 1024 ** 2 or digest_file(target) != digest:
            raise ValueError("model_digest_mismatch")


class PaddleReader:
    def __init__(self, root: Path, recognition_directory: Path | None = None, recognition_hash: str | None = None):
        verify_official_models(root)
        if (recognition_directory is None) != (recognition_hash is None):
            raise ValueError("untrusted_model_artifact")
        if recognition_directory is not None:
            verify_trained_model(recognition_directory, recognition_hash)
        from paddleocr import PaddleOCR
        self.reader = PaddleOCR(
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_detection_model_dir=str(root / ASSETS["detector"]["directory"]),
            text_recognition_model_name="PP-OCRv5_mobile_rec",
            text_recognition_model_dir=str(recognition_directory or root / ASSETS["recognizer"]["directory"]),
            text_recognition_batch_size=8,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_det_limit_side_len=1600,
            text_det_limit_type="max",
            text_rec_score_thresh=0.0,
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=2,
        )

    def read(self, image) -> list[Cell]:
        height, width = image.shape[:2]
        output = self.reader.predict(image)
        cells = []
        for result in output:
            texts, scores, polygons = result["rec_texts"], result["rec_scores"], result["rec_polys"]
            if len(texts) != len(scores) or len(texts) != len(polygons) or len(texts) > 2000:
                raise ValueError("invalid_recognizer_output")
            for text, score, polygon in zip(texts, scores, polygons, strict=True):
                points = np.asarray(polygon)
                x1, y1 = points.min(axis=0)
                x2, y2 = points.max(axis=0)
                box = (max(0.0, float(x1) / width), max(0.0, float(y1) / height), min(1.0, float(x2) / width), min(1.0, float(y2) / height))
                if not np.isfinite([*box, score]).all() or not 0 <= score <= 1:
                    raise ValueError("invalid_recognizer_output")
                if box[0] < box[2] and box[1] < box[3] and str(text).strip():
                    cells.append(Cell(str(text), float(score), box))
        return cells

    def close(self):
        self.reader.close()
