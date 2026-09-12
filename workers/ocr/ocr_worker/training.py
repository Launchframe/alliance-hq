import copy
import hashlib
import io
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import numpy as np
from PIL import Image
import psutil
import yaml

from .bootstrap import ASSETS, PADDLEOCR_REVISION, digest_file
from .build import worker_code_hash
from .contracts import TrainRequest
from .files import check_deadline, stable_json, verify_frame


def verify_training_source(source: Path):
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], timeout=10, text=True).strip()
    dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], timeout=10, text=True).strip()
    if revision != PADDLEOCR_REVISION or dirty:
        raise ValueError("training_source_mismatch")


def run_bounded(command: list[str], source: Path, work: Path, log: Path, deadline: float, memory_limit: int, seed: int, disk_limit: int, new_session=True):
    home = work / "home"
    home.mkdir(exist_ok=True)
    environment = {"PATH": os.defpath, "HOME": str(home), "PYTHONNOUSERSITE": "1", "PYTHONHASHSEED": str(seed), "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "CUDA_VISIBLE_DEVICES": "", "TZ": "UTC"}
    with log.open("xb") as output:
        process = subprocess.Popen(command, cwd=source, env=environment, stdout=output, stderr=subprocess.STDOUT, start_new_session=new_session)
        try:
            last_disk_check = 0.0
            while process.poll() is None:
                check_deadline(deadline)
                if time.monotonic() - last_disk_check >= 1:
                    if sum(path.stat().st_size for path in work.rglob("*") if path.is_file()) > disk_limit:
                        raise ValueError("worker_disk_limit")
                    last_disk_check = time.monotonic()
                try:
                    parent = psutil.Process(process.pid)
                    rss = parent.memory_info().rss + sum(child.memory_info().rss for child in parent.children(recursive=True))
                    if rss > memory_limit:
                        raise MemoryError("worker_memory_limit")
                except psutil.NoSuchProcess:
                    pass
                if log.stat().st_size > 16 * 1024 ** 2:
                    raise ValueError("worker_log_limit")
                time.sleep(0.2)
            if process.returncode != 0:
                raise ValueError("worker_process_failed")
            check_deadline(deadline)
            if sum(path.stat().st_size for path in work.rglob("*") if path.is_file()) > disk_limit:
                raise ValueError("worker_disk_limit")
        finally:
            if process.poll() is None:
                try:
                    if new_session:
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        for child in psutil.Process(process.pid).children(recursive=True):
                            try:
                                child.kill()
                            except psutil.NoSuchProcess:
                                pass
                        process.kill()
                except (ProcessLookupError, psutil.NoSuchProcess):
                    pass
            process.wait()


def prepare_crops(request: TrainRequest, input_root: Path, output_root: Path, characters: set[str], deadline: float):
    crops = output_root / "crops"
    crops.mkdir()
    lines = {"train": [], "validation": []}
    seen = {}
    total_bytes = 0
    for example in request.examples:
        frames = {frame.sha256: frame for frame in example.frames}
        for label in example.labels:
            check_deadline(deadline)
            if len(label.text) > 25 or any(character not in characters for character in label.text):
                raise ValueError("unsupported_training_text")
            path = verify_frame(input_root, frames[label.frame_sha256])
            with Image.open(path) as image:
                x1, y1, x2, y2 = label.box
                rectangle = (math.floor(x1 * image.width), math.floor(y1 * image.height), math.ceil(x2 * image.width), math.ceil(y2 * image.height))
                crop = image.convert("RGB").crop(rectangle)
                encoded = io.BytesIO()
                crop.save(encoded, format="PNG")
            data = encoded.getvalue()
            digest = hashlib.sha256(data).hexdigest()
            if digest in seen:
                if seen[digest] != (example.split, label.text):
                    raise ValueError("crop_label_conflict")
                continue
            seen[digest] = (example.split, label.text)
            total_bytes += len(data)
            if total_bytes > min(request.limits.max_work_bytes // 2, 512 * 1024 ** 2):
                raise ValueError("crop_byte_limit")
            (crops / f"{digest}.png").write_bytes(data)
            lines[example.split].append(f"crops/{digest}.png\t{label.text}\n")
    if not lines["train"]:
        raise ValueError("training_examples_required")
    for split, entries in lines.items():
        (output_root / f"{split}.txt").write_text("".join(entries), encoding="utf-8")
    return {split: len(entries) for split, entries in lines.items()}


def training_config(request: TrainRequest, source: Path, work: Path, pretrained: Path, counts: dict):
    config = yaml.safe_load((source / "configs/rec/PP-OCRv5/PP-OCRv5_mobile_rec.yml").read_text(encoding="utf-8"))
    config["Global"].update({"use_gpu": False, "distributed": False, "epoch_num": request.recipe.epochs, "seed": request.recipe.seed, "pretrained_model": str(pretrained), "checkpoints": None, "save_model_dir": str(work / "checkpoints"), "save_inference_dir": str(work / "artifact"), "save_res_path": str(work / "predictions.txt"), "save_epoch_step": request.recipe.epochs, "eval_batch_step": [0, 1000], "print_batch_step": 1, "uniform_output_enabled": False, "use_visualdl": False, "character_dict_path": str(source / "ppocr/utils/dict/ppocrv5_dict.txt")})
    config["Optimizer"]["lr"].update({"learning_rate": request.recipe.learning_rate, "warmup_epoch": 0})
    transforms = copy.deepcopy(config["Eval"]["dataset"]["transforms"])
    config["Train"].pop("sampler", None)
    config["Train"]["dataset"] = {"name": "SimpleDataSet", "data_dir": str(work / "data"), "label_file_list": [str(work / "data/train.txt")], "transforms": transforms}
    config["Train"]["loader"].update({"batch_size_per_card": request.recipe.batch_size, "drop_last": False, "num_workers": 0, "shuffle": True})
    if counts["validation"]:
        config["Eval"]["dataset"].update({"data_dir": str(work / "data"), "label_file_list": [str(work / "data/validation.txt")]})
        config["Eval"]["loader"].update({"batch_size_per_card": request.recipe.batch_size, "drop_last": False, "num_workers": 0, "shuffle": False})
    else:
        config["Eval"] = None
    return config


def changed_tensors(pretrained: Path, checkpoint: Path):
    import paddle
    before = paddle.load(str(pretrained))
    after = paddle.load(str(checkpoint))
    changed = 0
    for key, value in after.items():
        if not key.endswith((".weight", ".bias")) or key not in before or not hasattr(value, "shape") or not hasattr(before[key], "shape"):
            continue
        left, right = np.asarray(before[key]), np.asarray(value)
        if not np.isfinite(right).all():
            raise ValueError("invalid_trained_weights")
        if left.shape == right.shape and not np.array_equal(left, right):
            changed += 1
    if not changed:
        raise ValueError("training_did_not_update_weights")
    return changed


def train(request: TrainRequest, input_root: Path, source: Path, model_root: Path, work: Path, in_job=False):
    started = time.monotonic()
    deadline = started + request.limits.max_seconds
    source, work, model_root = source.resolve(), work.resolve(), model_root.resolve()
    verify_training_source(source)
    pretrained = model_root / ASSETS["pretrained"]["file"]
    if pretrained.is_symlink() or pretrained.stat().st_size != ASSETS["pretrained"]["bytes"] or digest_file(pretrained) != ASSETS["pretrained"]["sha256"]:
        raise ValueError("model_digest_mismatch")
    work.mkdir(parents=True, exist_ok=False, mode=0o700)
    (work / "data").mkdir()
    dictionary = source / "ppocr/utils/dict/ppocrv5_dict.txt"
    characters = set(dictionary.read_text(encoding="utf-8").splitlines()) | {" "}
    counts = prepare_crops(request, input_root, work / "data", characters, deadline)
    config = training_config(request, source, work, pretrained, counts)
    config_path = work / "training.yml"
    config_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
    run_bounded([sys.executable, str(source / "tools/train.py"), "-c", str(config_path)], source, work, work / "train.log", deadline, request.limits.max_memory_bytes, request.recipe.seed, request.limits.max_work_bytes, new_session=not in_job)
    checkpoint = work / "checkpoints/latest.pdparams"
    if not checkpoint.is_file():
        raise ValueError("training_checkpoint_missing")
    updated = changed_tensors(pretrained, checkpoint)
    check_deadline(deadline)
    run_bounded([sys.executable, str(source / "tools/export_model.py"), "-c", str(config_path), "-o", f"Global.pretrained_model={checkpoint}", f"Global.save_inference_dir={work / 'artifact'}"], source, work, work / "export.log", deadline, request.limits.max_memory_bytes, request.recipe.seed, request.limits.max_work_bytes, new_session=not in_job)
    artifact = work / "artifact"
    files = {}
    artifact_bytes = 0
    for path in sorted(artifact.rglob("*")):
        if path.is_symlink() or not path.resolve().is_relative_to(artifact):
            raise ValueError("unsafe_model_path")
        if path.is_file():
            artifact_bytes += path.stat().st_size
            if artifact_bytes > request.limits.max_output_bytes:
                raise ValueError("model_artifact_limit")
            files[str(path.relative_to(artifact))] = digest_file(path)
    if not files:
        raise ValueError("model_export_missing")
    manifest = {"version": 1, "family": request.recipe.family, "datasetHash": request.dataset_hash, "sourceRevision": PADDLEOCR_REVISION, "workerCodeHash": worker_code_hash(), "baseModelSha256": ASSETS["pretrained"]["sha256"], "recipe": request.recipe.model_dump(by_alias=True), "updatedTensors": updated, "samples": counts, "files": files}
    data = stable_json(manifest).encode("utf-8")
    (artifact / "manifest.json").write_bytes(data)
    return {"manifest": manifest, "artifactSha256": hashlib.sha256(data).hexdigest(), "totalMs": (time.monotonic() - started) * 1000, "checkpointSha256": digest_file(checkpoint)}
