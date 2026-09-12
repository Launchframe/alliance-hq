import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont

from ocr_worker.contracts import InferRequest, TrainRequest
from ocr_worker.inference import infer
from test_core import save_image

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / ".runtime/models"
SOURCE = ROOT / ".runtime/paddleocr"
LIMITS = {"maxSeconds": 300, "maxMemoryBytes": 4 * 1024 ** 3, "maxFrames": 20, "maxInputBytes": 10 * 1024 ** 2}


def image_for(name, score):
    image = Image.new("RGB", (1000, 220), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=48)
    draw.text((40, 70), name, font=font, fill="black")
    draw.text((550, 70), score, font=font, fill="black")
    return image


@unittest.skipUnless(os.environ.get("OCR_WORKER_MODEL_TEST") == "1", "requires verified local Paddle artifacts")
class PaddleIntegrationTest(unittest.TestCase):
    def test_real_detector_and_recognizer_produce_evidence_bound_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frame = save_image(root, image_for("ALPHA", "1234567"), None)
            request = InferRequest.model_validate({"version": 1, "caseId": "case-a", "scoreTarget": "vs-performance", "sourceSha256": frame.sha256, "pipelineVersion": "paddle-fixture", "frames": [frame.model_dump(by_alias=True)], "roster": [{"memberId": "a", "name": "ALPHA"}], "sampler": {"mode": "all"}, "limits": LIMITS})
            result = infer(request, root, MODELS)
            self.assertFalse(result["prediction"]["synthetic"])
            self.assertEqual(len(result["prediction"]["rows"]), 1)
            row = result["prediction"]["rows"][0]
            self.assertEqual((row["memberId"], row["score"]), ("a", "1234567"))
            self.assertEqual(row["evidence"][0]["frameSha256"], frame.sha256)
            self.assertIsNone(row["evidence"][0]["timestampSeconds"])
            self.assertEqual(result["prediction"]["selectedTimestamps"], [])

    def test_actual_gradient_training_exports_loadable_recognition_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = root / "inputs"
            inputs.mkdir()
            examples = []
            for index, (name, score, split) in enumerate([("ALPHA", "1234567", "train"), ("BETA", "7654321", "train"), ("GAMMA", "3456789", "validation")]):
                frame = save_image(inputs, image_for(name, score), index)
                examples.append({"caseId": f"case-{index}", "recordingGroupId": f"group-{index}", "sourceSha256": frame.sha256, "split": split, "frames": [frame.model_dump(by_alias=True)], "labels": [{"frameSha256": frame.sha256, "box": [0.03, 0.25, 0.3, 0.7], "text": name, "field": "name"}, {"frameSha256": frame.sha256, "box": [0.54, 0.25, 0.85, 0.7], "text": score, "field": "score"}]})
            request = TrainRequest.model_validate({"version": 1, "datasetHash": "a" * 64, "scoreTarget": "vs-performance", "examples": examples, "recipe": {"family": "paddle-v5-mobile-rec", "epochs": 1, "batchSize": 2, "learningRate": 0.00001, "seed": 7}, "limits": LIMITS})
            work = root / "work"
            input_path, output_path = root / "request.json", root / "result.json"
            input_path.write_text(request.model_dump_json(by_alias=True), encoding="utf-8")
            try:
                subprocess.run([sys.executable, "-m", "ocr_worker", "train", "--input", str(input_path), "--assets", str(inputs), "--models", str(MODELS), "--source", str(SOURCE), "--work", str(work), "--output", str(output_path)], cwd=ROOT, check=True, timeout=330)
                result = json.loads(output_path.read_text(encoding="utf-8"))
            except Exception:
                for name in ("train.log", "export.log"):
                    path = work / name
                    if path.exists():
                        print(path.read_text(encoding="utf-8", errors="replace")[-5000:])
                raise
            self.assertGreater(result["manifest"]["updatedTensors"], 0)
            self.assertEqual(result["manifest"]["samples"], {"train": 4, "validation": 2})
            self.assertEqual(len(result["artifactSha256"]), 64)
            frame = save_image(inputs, image_for("DELTA", "4567891"), 0)
            evaluation = InferRequest.model_validate({"version": 1, "caseId": "case-check", "scoreTarget": "vs-performance", "sourceSha256": frame.sha256, "pipelineVersion": result["artifactSha256"], "frames": [frame.model_dump(by_alias=True)], "sampler": {"mode": "all"}, "limits": LIMITS})
            prediction = infer(evaluation, inputs, MODELS, work / "artifact", result["artifactSha256"])
            self.assertGreater(len(prediction["prediction"]["rows"]), 0)


if __name__ == "__main__":
    unittest.main()
