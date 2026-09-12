from dataclasses import dataclass, field
from difflib import SequenceMatcher
import re
import unicodedata

from .contracts import Frame, RosterMember
from .engine import Cell
from .files import normalize_integer


def name_key(value: str) -> str:
    value = re.sub(r"^\s*\[[^\]]{1,16}\]\s*", "", value)
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def binding_label(value: str) -> bool:
    normalized = unicodedata.normalize("NFKD", name_key(value)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z]", "", normalized) in {"uid", "id", "playerid", "userid", "commanderid", "iddocomandante", "iddousuario", "iddojogador"}


def union_box(boxes):
    return (min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes))


def vertical_overlap(a, b):
    overlap = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    return overlap / max(0.0001, min(a[3] - a[1], b[3] - b[1]))


@dataclass
class RowObservation:
    name: str
    score: str | None
    rank: int | None
    confidence: float
    box: tuple
    frame: Frame
    name_box: tuple | None = None
    score_box: tuple | None = None
    member_id: str | None = None

    def evidence(self):
        result = {"frameSha256": self.frame.sha256, "timestampSeconds": self.frame.timestamp_seconds, "box": list(self.box)}
        if self.name_box is not None:
            result["nameBox"] = list(self.name_box)
        if self.score_box is not None:
            result["scoreBox"] = list(self.score_box)
        return result


def parse_rows(cells: list[Cell], frame: Frame) -> list[RowObservation]:
    groups = []
    for cell in sorted(cells, key=lambda item: ((item.box[1] + item.box[3]) / 2, item.box[0])):
        candidates = [group for group in groups if vertical_overlap(union_box([item.box for item in group]), cell.box) >= 0.5]
        if candidates:
            max(candidates, key=lambda group: vertical_overlap(union_box([item.box for item in group]), cell.box)).append(cell)
        else:
            groups.append([cell])
    rows = []
    for group in groups:
        group.sort(key=lambda item: item.box[0])
        if len(group) == 1:
            cell = group[0]
            match = re.fullmatch(r"\s*(?:(\d{1,3})\s+)?(.+?)\s+(\d[\d,. ]*)\s*", cell.text)
            if match and len(match[2].strip()) <= 160 and not binding_label(match[2]) and (score := normalize_integer(match[3])) is not None and any(char.isalpha() for char in match[2]):
                rank = int(match[1]) if match[1] and int(match[1]) > 0 else None
                rows.append(RowObservation(match[2].strip(), score, rank, cell.confidence, cell.box, frame))
            continue
        score_candidates = [cell for cell in group if (cell.box[0] + cell.box[2]) / 2 > 0.45 and normalize_integer(cell.text) is not None]
        score_cell = max(score_candidates, key=lambda cell: cell.box[2]) if score_candidates else group[-1]
        if score_cell.box[0] < 0.4:
            continue
        rank = None
        names = []
        for cell in group:
            if cell is score_cell or cell.box[0] >= score_cell.box[0]:
                continue
            number = normalize_integer(cell.text)
            if cell.box[2] < 0.18 and number is not None and 0 < int(number) <= 300:
                rank = int(number)
            else:
                names.append(cell)
        name = " ".join(cell.text.strip() for cell in names).strip()
        if not name or len(name) > 160 or binding_label(name):
            continue
        rows.append(RowObservation(name, normalize_integer(score_cell.text), rank, min([score_cell.confidence, *[cell.confidence for cell in names]]), union_box([cell.box for cell in group]), frame, union_box([cell.box for cell in names]), score_cell.box))
    return rows


def match_member(name: str, roster: list[RosterMember]) -> str | None:
    query = name_key(name)
    if not query:
        return None
    candidates = []
    for member in roster:
        names = {name_key(value) for value in [member.name, *member.aliases] if value}
        score = max((SequenceMatcher(None, query, value).ratio() for value in names), default=0.0)
        candidates.append((score, member.member_id))
    candidates.sort(reverse=True)
    if not candidates:
        return None
    first = candidates[0]
    second = candidates[1][0] if len(candidates) > 1 else 0.0
    if first[0] == 1 and second < 1 or len(query) >= 3 and first[0] >= 0.88 and first[0] - second >= 0.1:
        return first[1]
    return None


@dataclass
class Track:
    observations: list[RowObservation] = field(default_factory=list)

    @property
    def latest(self):
        return self.observations[-1]

    def prediction(self):
        weights = {}
        for observation in self.observations:
            weights[observation.score] = weights.get(observation.score, 0.0) + observation.confidence
        winner = max(weights, key=lambda score: (weights[score], score is not None, score or ""))
        matching = [observation for observation in self.observations if observation.score == winner]
        chosen = max(matching, key=lambda observation: (observation.confidence, len(observation.name)))
        confidence = chosen.confidence * weights[winner] / max(0.0001, sum(weights.values()))
        identities = {observation.member_id for observation in self.observations if observation.member_id is not None}
        return {
            "name": chosen.name, "score": winner,
            "memberId": next(iter(identities)) if len(identities) == 1 else None,
            "confidence": confidence,
            "evidence": [observation.evidence() for observation in self.observations],
        }


class RowTracker:
    def __init__(self, roster: list[RosterMember]):
        self.roster = roster
        self.tracks = []
        self.active = []

    def add(self, rows: list[RowObservation], vertical_motion=0.0, motion_confidence=1.0, scene_change=False):
        if scene_change:
            self.active = []
        used = set()
        for row in rows:
            row.member_id = match_member(row.name, self.roster)
            candidates = []
            for index in self.active:
                if index in used:
                    continue
                previous = self.tracks[index].latest
                if row.frame.timestamp_seconds is None or previous.frame.timestamp_seconds is None:
                    continue
                if row.frame.timestamp_seconds - previous.frame.timestamp_seconds > 10:
                    continue
                if row.rank is not None and previous.rank is not None and row.rank != previous.rank:
                    continue
                identity = row.member_id is not None and row.member_id == previous.member_id
                similarity = SequenceMatcher(None, name_key(row.name), name_key(previous.name)).ratio()
                if not identity and similarity < 0.82:
                    continue
                if row.member_id and previous.member_id and row.member_id != previous.member_id:
                    continue
                expected_y = (previous.box[1] + previous.box[3]) / 2 + vertical_motion
                distance = abs((row.box[1] + row.box[3]) / 2 - expected_y)
                height = max(row.box[3] - row.box[1], previous.box[3] - previous.box[1])
                if motion_confidence >= 0.15 and distance <= height * 1.2:
                    candidates.append((distance, -similarity, index))
            if candidates:
                index = min(candidates)[2]
                self.tracks[index].observations.append(row)
            else:
                if len(self.tracks) >= 2000:
                    raise ValueError("row_budget_exceeded")
                index = len(self.tracks)
                self.tracks.append(Track([row]))
                self.active.append(index)
            used.add(index)
        if rows:
            timestamp = rows[0].frame.timestamp_seconds
            self.active = [] if timestamp is None else [index for index in self.active if self.tracks[index].latest.frame.timestamp_seconds is not None and timestamp - self.tracks[index].latest.frame.timestamp_seconds <= 10]

    def predictions(self):
        return [track.prediction() for track in self.tracks]
