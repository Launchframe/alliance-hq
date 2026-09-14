import json
import os
from pathlib import Path
import re
import sys

from .build import worker_code_hash
from .contracts import InferRequest, TrainRequest
from .files import read_json, stable_json


def main():
    try:
        dispatch = read_json(Path(sys.argv[1]), 8 * 1024 ** 2)
        action = dispatch["action"]
        assets, models = Path(dispatch["assets"]), Path(dispatch["models"])
        if action == "infer":
            from .inference import infer
            directory = Path(dispatch["recognizer"]) if dispatch["recognizer"] else None
            result = infer(InferRequest.model_validate(dispatch["input"]), assets, models, directory, dispatch["recognizerHash"])
        elif action == "train":
            from .training import train
            result = train(TrainRequest.model_validate(dispatch["input"]), assets, Path(dispatch["source"]), models, Path(dispatch["work"]), in_job=True)
        else:
            raise ValueError("invalid_worker_action")
        result["workerCodeHash"] = worker_code_hash()
        encoded = stable_json(result).encode("utf-8")
        if len(encoded) > 8 * 1024 ** 2:
            raise ValueError("worker_result_limit")
        descriptor = os.open(dispatch["output"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
        return 0
    except Exception as error:
        value = str(error)
        code = value if re.fullmatch(r"[a-z_]{1,80}", value) else "worker_failed"
        print(json.dumps({"state": "failed", "code": code}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
