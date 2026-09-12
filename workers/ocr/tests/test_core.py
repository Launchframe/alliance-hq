import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw
from pydantic import ValidationError

from ocr_worker.contracts import CellLabel, Frame, InferRequest, RosterMember, Sampler, TrainRequest
from ocr_worker.engine import Cell, verify_trained_model
from ocr_worker.files import load_frame, normalize_integer
from ocr_worker.rows import RowObservation, RowTracker, match_member, parse_rows
from ocr_worker.sampling import select_frames
from ocr_worker.training import run_bounded


def frame(index=0):
    return Frame(sha256=f"{index:064x}", bytes=100, timestamp_seconds=index, width=1000, height=1000)


def save_image(root, image, timestamp):
    output = io.BytesIO()
    image.save(output, format="PNG")
    data = output.getvalue()
    sha = hashlib.sha256(data).hexdigest()
    (root / f"{sha}.bin").write_bytes(data)
    return Frame(sha256=sha, bytes=len(data), timestamp_seconds=timestamp, width=image.width, height=image.height)


class ContractsTest(unittest.TestCase):
    def test_exact_integers_never_expand_compact_or_fractional_scores(self):
        self.assertEqual(normalize_integer("1.234.567"), "1234567")
        self.assertEqual(normalize_integer("0"), "0")
        self.assertIsNone(normalize_integer("12.5"))
        self.assertIsNone(normalize_integer("12M"))
        self.assertIsNone(normalize_integer("9007199254740992"))

    def test_inference_contract_has_no_ground_truth_or_credentials(self):
        request = {"version": 1, "caseId": "case-a", "scoreTarget": "vs-performance", "sourceSha256": "a" * 64, "pipelineVersion": "fixture", "frames": [frame().model_dump(by_alias=True)], "sampler": {}, "limits": {"maxSeconds": 30, "maxMemoryBytes": 1024 ** 3, "maxFrames": 2, "maxInputBytes": 1000}}
        self.assertEqual(InferRequest.model_validate(request).case_id, "case-a")
        with self.assertRaises(ValidationError):
            InferRequest.model_validate({**request, "labels": []})
        with self.assertRaises(ValidationError):
            InferRequest.model_validate({**request, "gameUid": "fixture-private-binding"})

    def test_held_out_labels_cannot_enter_training(self):
        example = {"caseId": "case-a", "recordingGroupId": "group-a", "sourceSha256": "a" * 64, "split": "test", "frames": [frame().model_dump(by_alias=True)], "labels": [{"frameSha256": frame().sha256, "field": "score", "text": "100", "box": [0.1, 0.1, 0.9, 0.2]}]}
        request = {"version": 1, "datasetHash": "b" * 64, "scoreTarget": "vs-performance", "examples": [example], "recipe": {"family": "paddle-v5-mobile-rec", "epochs": 1, "batchSize": 2, "learningRate": 0.0001, "seed": 1}, "limits": {"maxSeconds": 60, "maxMemoryBytes": 1024 ** 3, "maxFrames": 2, "maxInputBytes": 1000}}
        with self.assertRaises(ValidationError):
            TrainRequest.model_validate(request)
        example["split"] = "train"
        request["examples"] = [example, {**example, "caseId": "case-b", "split": "validation"}]
        with self.assertRaises(ValidationError):
            TrainRequest.model_validate(request)
        with self.assertRaises(ValidationError):
            CellLabel(frame_sha256=frame().sha256, field="name", text="Alpha\n../other", box=(0, 0, 1, 1))


class TrackingTest(unittest.TestCase):
    def setUp(self):
        self.roster = [RosterMember(member_id="a", name="Alpha"), RosterMember(member_id="b", name="Beta")]

    def test_geometry_pairs_cells_without_merging_equal_score_players(self):
        cells = [Cell("1", 0.99, (0.02, 0.1, 0.05, 0.15)), Cell("Alpha", 0.9, (0.2, 0.1, 0.4, 0.15)), Cell("1,000", 0.95, (0.65, 0.1, 0.9, 0.15)), Cell("Beta", 0.9, (0.2, 0.3, 0.4, 0.35)), Cell("1,000", 0.95, (0.65, 0.3, 0.9, 0.35))]
        rows = parse_rows(cells, frame())
        tracker = RowTracker(self.roster)
        tracker.add(rows)
        predictions = tracker.predictions()
        self.assertEqual(len(predictions), 2)
        self.assertEqual({row["memberId"] for row in predictions}, {"a", "b"})
        self.assertEqual({row["score"] for row in predictions}, {"1000"})

    def test_tracks_motion_and_keeps_conflicting_evidence(self):
        tracker = RowTracker(self.roster)
        tracker.add([RowObservation("Alpha", "100", 1, 0.9, (0.1, 0.2, 0.9, 0.25), frame(0))])
        tracker.add([RowObservation("Alpha", "900", 1, 0.9, (0.1, 0.3, 0.9, 0.35), frame(1))], vertical_motion=0.1)
        output = tracker.predictions()
        self.assertEqual(len(output), 1)
        self.assertEqual(len(output[0]["evidence"]), 2)
        self.assertLess(output[0]["confidence"], 0.5)

    def test_does_not_guess_ambiguous_identities_or_cross_scene_boundaries(self):
        self.assertIsNone(match_member("Alpha", [*self.roster, RosterMember(member_id="c", name="Alpha")]))
        tracker = RowTracker(self.roster)
        tracker.add([RowObservation("Alpha", "100", 1, 0.9, (0.1, 0.2, 0.9, 0.25), frame(0))])
        tracker.add([RowObservation("Alpha", "100", 1, 0.9, (0.1, 0.2, 0.9, 0.25), frame(1))], scene_change=True)
        self.assertEqual(len(tracker.predictions()), 2)


class SamplingTest(unittest.TestCase):
    def test_sampling_is_bounded_keeps_bookends_and_checks_real_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frames = []
            for index in range(5):
                image = Image.new("RGB", (200, 160), "white")
                ImageDraw.Draw(image).rectangle((20, 10 + index * 10, 180, 20 + index * 10), fill="black")
                frames.append(save_image(root, image, index))
            output = select_frames(root, frames, Sampler(max_gap_seconds=1, max_selected_frames=3), time.monotonic() + 10)
            self.assertLessEqual(len(output.frames), 3)
            self.assertEqual(output.frames[0], frames[0])
            self.assertEqual(output.frames[-1], frames[-1])
            (root / f"{frames[0].sha256}.bin").write_bytes(b"changed")
            with self.assertRaises(ValueError):
                load_frame(root, frames[0])


class WorkerBoundaryTest(unittest.TestCase):
    def test_training_child_has_no_control_plane_credentials_and_obeys_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            with patch.dict(os.environ, {"OCR_WORKER_SECRET": "fixture-not-real"}):
                run_bounded([sys.executable, "-c", "import os; print('OCR_WORKER_SECRET' in os.environ)"], work, work, work / "child.log", time.monotonic() + 10, 512 * 1024 ** 2, 1, 1024 ** 2)
            self.assertEqual((work / "child.log").read_text().strip(), "False")
            started = time.monotonic()
            with self.assertRaises(TimeoutError):
                run_bounded([sys.executable, "-c", "import time; time.sleep(30)"], work, work, work / "timeout.log", time.monotonic() + 0.3, 512 * 1024 ** 2, 1, 1024 ** 2)
            self.assertLess(time.monotonic() - started, 5)

    def test_model_manifest_rejects_tampering_and_unregistered_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {}
            for name in ("inference.json", "inference.yml", "inference.pdiparams"):
                data = b"fixture-model-file"
                (root / name).write_bytes(data)
                files[name] = hashlib.sha256(data).hexdigest()
            manifest = json.dumps({"version": 1, "family": "paddle-v5-mobile-rec", "files": files}).encode()
            (root / "manifest.json").write_bytes(manifest)
            digest = hashlib.sha256(manifest).hexdigest()
            verify_trained_model(root, digest)
            (root / "unregistered.pdmodel").write_bytes(b"fixture")
            with self.assertRaises(ValueError):
                verify_trained_model(root, digest)
            with self.assertRaises(ValueError):
                verify_trained_model(root, "0" * 64)

    def test_binding_labels_are_not_emitted_as_scores(self):
        cells = [Cell("Player ID", 0.99, (0.1, 0.1, 0.4, 0.2)), Cell("1" + "0" * 11, 0.99, (0.6, 0.1, 0.9, 0.2))]
        self.assertEqual(parse_rows(cells, frame()), [])
        cells[0] = Cell("Alpha", 0.99, cells[0].box)
        self.assertEqual(len(parse_rows(cells, frame())), 1)


if __name__ == "__main__":
    unittest.main()
