from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

from ocr_worker.client import ControlPlane, execute_job
from ocr_worker.model_archive import pack_model, unpack_model


class TransportTest(unittest.TestCase):
    def test_control_credentials_are_scoped_to_a_fixed_secure_origin(self):
        client = ControlPlane("http://127.0.0.1:12345", "fixture-secret")
        self.assertFalse(client.session.trust_env)
        with self.assertRaises(ValueError):
            client.response("GET", "https://different.invalid/api/internal/ocr-worker/claim")
        with self.assertRaises(ValueError):
            ControlPlane("http://different.invalid", "fixture-secret")
        with self.assertRaises(ValueError):
            ControlPlane("https://user:secret@different.invalid", "fixture-secret")
        client.session.close()

    def test_upload_cannot_forward_control_credentials_to_arbitrary_origins(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "model.bin"
            source.write_bytes(b"fixture")
            client = ControlPlane("https://control.invalid", "fixture-secret")
            with patch("requests.Session") as session:
                with self.assertRaises(ValueError):
                    client.upload({"url": "https://different.invalid/upload", "bytes": 7, "contentType": "application/octet-stream"}, source, "lease")
                session.assert_not_called()
            client.session.close()

    def test_downloads_are_rejected_before_the_spool_budget_is_exceeded(self):
        frames = [{"sha256": f"{index:064x}", "bytes": 20 * 1024 ** 2, "timestampSeconds": index, "width": 100, "height": 100} for index in range(15)]
        limits = {"maxSeconds": 1, "maxMemoryBytes": 256 * 1024 ** 2, "maxFrames": 15, "maxInputBytes": 512 * 1024 ** 2, "maxWorkBytes": 256 * 1024 ** 2, "maxOutputBytes": 1024 ** 2}
        request = {"version": 1, "caseId": "case", "scoreTarget": "vs-performance", "sourceSha256": "a" * 64, "pipelineVersion": "fixture", "frames": frames, "sampler": {"mode": "all"}, "limits": limits}
        job = {"id": "job", "leaseToken": "lease", "kind": "evaluate", "input": request, "leaseExpiresAt": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(), "assets": [{"sha256": frame["sha256"], "bytes": frame["bytes"]} for frame in frames]}
        client = Mock(spec=ControlPlane)
        client.download.side_effect = AssertionError("unexpected_download")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "worker_disk_limit"):
                execute_job(client, job, root, root, root)
        client.download.assert_not_called()

    def test_model_archives_round_trip_and_reject_paths_outside_the_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "model"
            model.mkdir()
            files = {}
            for name in ("inference.json", "inference.yml", "inference.pdiparams"):
                content = b"fixture-model"
                (model / name).write_bytes(content)
                files[name] = hashlib.sha256(content).hexdigest()
            text = json.dumps({"version": 1, "family": "paddle-v5-mobile-rec", "files": files}).encode()
            (model / "manifest.json").write_bytes(text)
            manifest_hash = hashlib.sha256(text).hexdigest()
            over_budget = root / "over-budget.tar"
            with self.assertRaisesRegex(ValueError, "model_artifact_limit"):
                pack_model(model, manifest_hash, over_budget, 1)
            self.assertFalse(over_budget.exists())
            archive = root / "model.tar"
            result = pack_model(model, manifest_hash, archive, 1024 * 1024)
            restored = unpack_model(archive, root / "restored", result["sha256"], manifest_hash, 1024 * 1024)
            self.assertEqual((restored / "manifest.json").read_bytes(), text)
            malicious = root / "malicious.tar"
            with tarfile.open(malicious, "w") as bundle:
                for name in ("manifest.json", "inference.json", "../outside"):
                    entry = tarfile.TarInfo(name)
                    entry.size = len(text)
                    bundle.addfile(entry, io.BytesIO(text))
            bad_hash = hashlib.sha256(malicious.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                unpack_model(malicious, root / "rejected", bad_hash, manifest_hash, 1024 * 1024)
            self.assertFalse((root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
