import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urljoin, urlparse

import requests

from .build import worker_code_hash
from .contracts import InferRequest, TrainRequest
from .files import read_json, stable_json
from .model_archive import pack_model, unpack_model
from .training import handle_shutdown, run_bounded


class ControlPlane:
    def __init__(self, base: str, secret: str):
        parsed = urlparse(base)
        local = parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if not secret or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/") or not (parsed.scheme == "https" or local):
            raise ValueError("invalid_control_plane")
        self.base = base.rstrip("/") + "/"
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers["Authorization"] = f"Bearer {secret}"

    def response(self, method: str, path: str, token=None, **kwargs):
        if not path.startswith("/api/internal/ocr-worker/"):
            raise ValueError("invalid_control_path")
        headers = kwargs.pop("headers", {})
        if token:
            headers["X-Ocr-Lease"] = token
        timeout = kwargs.pop("timeout", (10, 60))
        response = self.session.request(method, urljoin(self.base, path), headers=headers, timeout=timeout, allow_redirects=False, **kwargs)
        if not 200 <= response.status_code < 300:
            try:
                code = response.json().get("code", "worker_request_failed")
            except ValueError:
                code = "worker_request_failed"
            response.close()
            raise ValueError(code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,80}", code) else "worker_request_failed")
        return response

    def json(self, method: str, path: str, token=None, body=None, timeout=(10, 60)):
        with self.response(method, path, token, json=body, stream=True, timeout=timeout) as response:
            data = bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data) > 8 * 1024 ** 2:
                    raise ValueError("worker_response_limit")
            return json.loads(data)

    def download(self, path: str, target: Path, sha256: str, size: int, token: str, tick):
        if not re.fullmatch(r"[a-f0-9]{64}", sha256) or not isinstance(size, int) or not 0 < size <= 2 * 1024 ** 3:
            raise ValueError("invalid_worker_asset")
        digest = hashlib.sha256()
        count = 0
        with self.response("GET", path, token, stream=True) as response, target.open("xb") as output:
            for chunk in response.iter_content(1024 * 1024):
                tick()
                count += len(chunk)
                if count > size:
                    raise ValueError("worker_asset_limit")
                digest.update(chunk)
                output.write(chunk)
        if count != size or digest.hexdigest() != sha256:
            raise ValueError("worker_asset_changed")

    def upload(self, upload: dict, path: Path, token: str):
        if path.stat().st_size != upload["bytes"]:
            raise ValueError("artifact_size_mismatch")
        headers = {"Content-Type": upload["contentType"], "Content-Length": str(upload["bytes"])}
        with path.open("rb") as source:
            if upload["url"].startswith("/api/internal/ocr-worker/artifacts/"):
                with self.response("PUT", upload["url"], token, headers=headers, data=source):
                    return
            target = urlparse(upload["url"])
            if target.scheme != "https" or target.username or target.password or not target.hostname or not target.hostname.endswith(".r2.cloudflarestorage.com"):
                raise ValueError("invalid_artifact_upload")
            with requests.Session() as session:
                session.trust_env = False
                response = session.put(upload["url"], headers=headers, data=source, timeout=(10, 120), allow_redirects=False)
                try:
                    if not 200 <= response.status_code < 300:
                        raise ValueError("artifact_upload_failed")
                finally:
                    response.close()


def execute_job(client: ControlPlane, job: dict, models: Path, source: Path, spool: Path):
    if job["kind"] not in ("train", "evaluate"):
        raise ValueError("invalid_worker_job")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job["id"]) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job["leaseToken"]):
        raise ValueError("invalid_worker_job")
    request = TrainRequest.model_validate(job["input"]) if job["kind"] == "train" else InferRequest.model_validate(job["input"])
    prefix, token = f"/api/internal/ocr-worker/jobs/{job['id']}", job["leaseToken"]
    expires = datetime.fromisoformat(job["leaseExpiresAt"].replace("Z", "+00:00"))
    last_tick = 0.0
    def tick():
        nonlocal last_tick
        if datetime.now(timezone.utc) >= expires:
            raise TimeoutError("stale_worker_lease")
        if time.monotonic() - last_tick >= 10:
            client.json("POST", prefix + "/heartbeat", token, {}, timeout=(3, 5))
            last_tick = time.monotonic()
    spool.mkdir(parents=True, exist_ok=True, mode=0o700)
    build_hash = worker_code_hash()
    with tempfile.TemporaryDirectory(prefix=job["id"] + "-", dir=spool) as directory:
        root = Path(directory)
        assets = root / "assets"
        assets.mkdir(mode=0o700)
        frames = request.frames if isinstance(request, InferRequest) else [frame for example in request.examples for frame in example.frames]
        expected = {frame.sha256: frame.bytes for frame in frames}
        described = {asset["sha256"]: asset["bytes"] for asset in job["assets"]}
        if expected != described:
            raise ValueError("worker_asset_set_mismatch")
        input_bytes = sum(expected.values())
        if input_bytes > request.limits.max_work_bytes:
            raise ValueError("worker_disk_limit")
        for sha256, size in expected.items():
            client.download(prefix + f"/assets/{sha256}", assets / f"{sha256}.bin", sha256, size, token, tick)
        model = client.json("GET", prefix + "/model", token)["model"]
        recognizer = None
        if model:
            if input_bytes + 2 * model["bytes"] > request.limits.max_work_bytes or model["bytes"] > request.limits.max_output_bytes:
                raise ValueError("worker_disk_limit")
            archive = root / "model.tar"
            client.download(prefix + "/model/data", archive, model["sha256"], model["bytes"], token, tick)
            recognizer = unpack_model(archive, root / "recognizer", model["sha256"], model["manifestHash"], request.limits.max_output_bytes)
        output = root / "output.json"
        work = root / "training"
        dispatch = {"action": "train" if job["kind"] == "train" else "infer", "input": request.model_dump(by_alias=True), "assets": str(assets), "models": str(models.resolve()), "source": str(source.resolve()), "work": str(work), "output": str(output), "recognizer": str(recognizer) if recognizer else None, "recognizerHash": model["manifestHash"] if model else None}
        dispatch_path = root / "dispatch.json"
        encoded = stable_json(dispatch).encode("utf-8")
        if sum(item.stat().st_size for item in root.rglob("*") if item.is_file()) + len(encoded) > request.limits.max_work_bytes:
            raise ValueError("worker_disk_limit")
        dispatch_path.write_bytes(encoded)
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
        deadline = time.monotonic() + min(remaining, request.limits.max_seconds)
        seed = request.recipe.seed if isinstance(request, TrainRequest) else 0
        run_bounded([sys.executable, "-m", "ocr_worker.execute", str(dispatch_path)], Path(__file__).resolve().parents[1], root, root / "worker.log", deadline, request.limits.max_memory_bytes, seed, request.limits.max_work_bytes, on_tick=tick)
        result = read_json(output, 8 * 1024 ** 2)
        if result.get("workerCodeHash") != build_hash or worker_code_hash() != build_hash:
            raise ValueError("worker_build_changed")
        artifact_id = None
        if job["kind"] == "train":
            archive = root / "artifact.tar"
            available = request.limits.max_work_bytes - sum(item.stat().st_size for item in root.rglob("*") if item.is_file())
            descriptor = pack_model(work / "artifact", result["artifactSha256"], archive, min(request.limits.max_output_bytes, available))
            reserved = client.json("POST", prefix + "/artifacts", token, descriptor)
            artifact_id = reserved["id"]
            if reserved["upload"]:
                client.upload(reserved["upload"], archive, token)
        tick()
        body = {"output": result, **({"artifactId": artifact_id} if artifact_id else {})}
        for attempt in range(2):
            try:
                return client.json("POST", prefix + "/complete", token, body, timeout=(10, 300))
            except requests.RequestException:
                if attempt:
                    raise


def main():
    handle_shutdown()
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--models", type=Path, default=Path(".runtime/models"))
    parser.add_argument("--source", type=Path, default=Path(".runtime/paddleocr"))
    parser.add_argument("--spool", type=Path, default=Path(".runtime/jobs"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--job-id")
    args = parser.parse_args()
    if args.job_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", args.job_id):
        raise ValueError("invalid_worker_job")
    client = ControlPlane(args.base_url, os.environ.get("OCR_WORKER_SECRET", ""))
    while True:
        failed = False
        job = client.json("POST", "/api/internal/ocr-worker/claim", body={"workerCodeHash": worker_code_hash(), **({"jobId": args.job_id} if args.job_id else {})})["job"]
        if job:
            try:
                execute_job(client, job, args.models, args.source, args.spool)
                print(json.dumps({"jobId": job["id"], "state": "ready"}), flush=True)
            except Exception as error:
                failed = True
                value = str(error)
                code = value if re.fullmatch(r"[a-z_]{1,80}", value) else "worker_failed"
                job_id = job.get("id") if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", str(job.get("id", ""))) else None
                try:
                    if job_id:
                        client.json("POST", f"/api/internal/ocr-worker/jobs/{job_id}/fail", job.get("leaseToken"), {"code": code})
                except (ValueError, requests.RequestException):
                    pass
                print(json.dumps({"jobId": job_id, "state": "failed", "code": code}), flush=True)
        if args.once:
            return 1 if failed else 0
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
