from pathlib import Path
import resource
import sys
import time

from .contracts import InferRequest
from .engine import PaddleReader
from .files import check_deadline, load_frame
from .rows import RowTracker, parse_rows
from .sampling import frame_features, motion, select_frames


def peak_memory_bytes():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def infer(request: InferRequest, input_root: Path, model_root: Path, recognition_directory: Path | None = None, recognition_hash: str | None = None):
    started = time.monotonic()
    deadline = started + request.limits.max_seconds
    selection = select_frames(input_root, request.frames, request.sampler, deadline)
    tracker = RowTracker(request.roster)
    reader = PaddleReader(model_root, recognition_directory, recognition_hash)
    previous = None
    observations = []
    try:
        for frame in selection.frames:
            check_deadline(deadline)
            image = load_frame(input_root, frame)
            gray, _ = frame_features(image)
            dy, confidence, scene = (0.0, 1.0, False) if previous is None else motion(previous, gray)
            rows = parse_rows(reader.read(image), frame)
            tracker.add(rows, dy * 0.84, confidence, scene)
            observations.extend({"name": row.name, "score": row.score, "rank": row.rank, "memberId": row.member_id, "confidence": row.confidence, "evidence": row.evidence()} for row in rows)
            previous = gray
            if peak_memory_bytes() > request.limits.max_memory_bytes:
                raise MemoryError("worker_memory_limit")
        check_deadline(deadline)
    finally:
        reader.close()
    prediction = {
        "version": 1, "caseId": request.case_id, "scoreTarget": request.score_target,
        "sourceSha256": request.source_sha256, "pipelineVersion": request.pipeline_version,
        "engine": "paddleocr", "synthetic": False,
        "selectedTimestamps": [frame.timestamp_seconds for frame in selection.frames if frame.timestamp_seconds is not None],
        "totalMs": (time.monotonic() - started) * 1000,
        "requests": len(selection.frames), "peakMemoryBytes": peak_memory_bytes(),
        "rows": tracker.predictions(),
    }
    return {"prediction": prediction, "samplingBudgetLimited": selection.bounded, "samplerFeatures": selection.features, "observations": observations}
