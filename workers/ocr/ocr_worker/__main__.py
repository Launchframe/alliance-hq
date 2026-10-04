import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

from .build import worker_code_hash
from .contracts import InferRequest, TrainRequest
from .files import read_json, stable_json
from .training import handle_shutdown, run_bounded


def child_error(log: Path):
    with log.open("rb") as source:
        source.seek(max(0, log.stat().st_size - 8192))
        lines = source.read().decode("utf-8", errors="replace").splitlines()
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("state") == "failed" and re.fullmatch(r"[a-z_]{1,80}", str(entry.get("code", ""))):
            return entry["code"]
    return "worker_process_failed"


def main():
    handle_shutdown()
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("infer", "train"))
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--work", type=Path)
    parser.add_argument("--recognizer", type=Path)
    parser.add_argument("--recognizer-hash")
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError("output_already_exists")
        payload = read_json(args.input)
        request = InferRequest.model_validate(payload) if args.action == "infer" else TrainRequest.model_validate(payload)
        if (args.recognizer is None) != (args.recognizer_hash is None):
            raise ValueError("untrusted_model_artifact")
        if args.action == "train" and (args.source is None or args.work is None):
            raise ValueError("training_paths_required")
        build_hash = worker_code_hash()
        with tempfile.TemporaryDirectory(prefix="ocr-execution-") as directory:
            root = Path(directory)
            result_path, log = root / "result.json", root / "worker.log"
            dispatch = {"action": args.action, "input": request.model_dump(by_alias=True), "assets": str(args.assets.resolve()), "models": str(args.models.resolve()), "output": str(result_path), "source": str(args.source.resolve()) if args.source else None, "work": str(args.work.resolve()) if args.work else None, "recognizer": str(args.recognizer.resolve()) if args.recognizer else None, "recognizerHash": args.recognizer_hash}
            dispatch_path = root / "dispatch.json"
            dispatch_path.write_text(stable_json(dispatch), encoding="utf-8")
            seed = request.recipe.seed if isinstance(request, TrainRequest) else 0
            try:
                run_bounded([sys.executable, "-m", "ocr_worker.execute", str(dispatch_path)], Path(__file__).resolve().parents[1], root, log, time.monotonic() + request.limits.max_seconds, request.limits.max_memory_bytes, seed, request.limits.max_work_bytes)
            except ValueError as error:
                if str(error) != "worker_process_failed":
                    raise
                raise ValueError(child_error(log)) from None
            result = read_json(result_path, 8 * 1024 ** 2)
            if result.get("workerCodeHash") != build_hash or worker_code_hash() != build_hash:
                raise ValueError("worker_build_changed")
            encoded = stable_json(result).encode("utf-8")
        args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
        print(json.dumps({"state": "completed", "resultSha256": hashlib.sha256(encoded).hexdigest()}))
        return 0
    except Exception as error:
        value = str(error)
        code = value if re.fullmatch(r"[a-z_]{1,80}", value) else "worker_failed"
        print(json.dumps({"state": "failed", "code": code}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
