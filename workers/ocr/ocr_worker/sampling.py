from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .contracts import Frame, Sampler
from .files import check_deadline, load_frame


@dataclass(frozen=True)
class Selection:
    frames: list[Frame]
    bounded: bool
    features: list[dict]


def frame_features(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = gray[int(height * 0.08):max(int(height * 0.92), 1), :]
    target_width = min(width, 384)
    gray = cv2.resize(gray, (target_width, max(1, round(gray.shape[0] * target_width / width))))
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return gray, sharpness


def motion(previous, current):
    if previous.shape != current.shape:
        return 0.0, 0.0, True
    shift, response = cv2.phaseCorrelate(previous.astype(np.float32), current.astype(np.float32))
    change = float(np.mean(cv2.absdiff(previous, current))) / 255
    stable_response = max(0.0, min(1.0, float(response)))
    dy = float(shift[1]) / current.shape[0] if stable_response >= 0.15 else 0.0
    scene = change > 0.4 and stable_response < 0.15
    return dy, stable_response, scene


def select_frames(root: Path, frames: list[Frame], policy: Sampler, deadline: float) -> Selection:
    if not frames:
        raise ValueError("frames_required")
    if any(frame.timestamp_seconds is None for frame in frames):
        if len(frames) != 1:
            raise ValueError("untimed_frame_sequence")
        return Selection(frames, False, [])
    ordered = sorted(frames, key=lambda frame: (frame.timestamp_seconds, frame.sha256))
    if policy.mode == "all":
        return Selection(ordered[:policy.max_selected_frames], len(ordered) > policy.max_selected_frames, [])
    selected = []
    features = []
    pending = []
    previous = None
    moved = 0.0
    last_time = ordered[0].timestamp_seconds
    for frame in ordered:
        check_deadline(deadline)
        gray, sharpness = frame_features(load_frame(root, frame))
        dy, response, scene = (0.0, 1.0, False) if previous is None else motion(previous, gray)
        moved += abs(dy)
        features.append({"sha256": frame.sha256, "timestampSeconds": frame.timestamp_seconds, "sharpness": sharpness, "verticalMotion": dy, "motionConfidence": response, "sceneChange": scene})
        pending.append((frame, sharpness))
        due = frame.timestamp_seconds - last_time >= policy.max_gap_seconds
        settled = abs(dy) < policy.min_shift_fraction / 3
        if not selected or scene or due or moved >= policy.min_shift_fraction and settled:
            choice = max(pending[-2:], key=lambda item: (item[1], item[0].timestamp_seconds))[0]
            if not selected or choice.sha256 != selected[-1].sha256:
                selected.append(choice)
            last_time = frame.timestamp_seconds
            moved = 0.0
            pending.clear()
        previous = gray
    if ordered[-1].sha256 not in {frame.sha256 for frame in selected}:
        selected.append(ordered[-1])
    bounded = len(selected) > policy.max_selected_frames
    if bounded:
        if policy.max_selected_frames == 1:
            selected = [selected[0]]
        else:
            indices = np.linspace(0, len(selected) - 1, policy.max_selected_frames).round().astype(int)
            selected = [selected[index] for index in indices]
    return Selection(selected, bounded, features)
