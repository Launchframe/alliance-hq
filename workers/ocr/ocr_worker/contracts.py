from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

Hash = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")]
Target = Literal["vs-performance", "alliance-kills-video"]
Box = tuple[float, float, float, float]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class Limits(Contract):
    max_seconds: int = Field(ge=1, le=3600)
    max_memory_bytes: int = Field(ge=256 * 1024 ** 2, le=32 * 1024 ** 3)
    max_frames: int = Field(ge=1, le=2000)
    max_input_bytes: int = Field(ge=1, le=2 * 1024 ** 3)
    max_work_bytes: int = Field(default=4 * 1024 ** 3, ge=256 * 1024 ** 2, le=16 * 1024 ** 3)
    max_output_bytes: int = Field(default=256 * 1024 ** 2, ge=1, le=2 * 1024 ** 3)


class Frame(Contract):
    sha256: Hash
    bytes: int = Field(ge=1, le=20 * 1024 ** 2)
    timestamp_seconds: float | None = Field(default=None, ge=0, le=86400)
    width: int = Field(ge=1, le=10000)
    height: int = Field(ge=1, le=10000)

    @model_validator(mode="after")
    def pixel_budget(self):
        if self.width * self.height > 6_000_000:
            raise ValueError("pixel_budget_exceeded")
        return self


class RosterMember(Contract):
    member_id: Identifier
    name: str = Field(min_length=1, max_length=160)
    aliases: list[Annotated[str, StringConstraints(max_length=160)]] = Field(default_factory=list, max_length=30)


class Sampler(Contract):
    mode: Literal["all", "coverage"] = "coverage"
    min_shift_fraction: float = Field(default=0.12, gt=0, le=1)
    max_gap_seconds: float = Field(default=1.5, gt=0, le=30)
    max_selected_frames: int = Field(default=100, ge=1, le=100)


class InferRequest(Contract):
    version: Literal[1]
    case_id: Identifier
    score_target: Target
    source_sha256: Hash
    pipeline_version: str = Field(min_length=1, max_length=128)
    frames: list[Frame] = Field(min_length=1, max_length=2000)
    roster: list[RosterMember] = Field(default_factory=list, max_length=500)
    sampler: Sampler
    limits: Limits

    @model_validator(mode="after")
    def input_budget(self):
        if len(self.frames) > self.limits.max_frames or sum(frame.bytes for frame in self.frames) > self.limits.max_input_bytes:
            raise ValueError("input_budget_exceeded")
        if len({frame.sha256 for frame in self.frames}) != len(self.frames):
            raise ValueError("duplicate_frame")
        return self


class CellLabel(Contract):
    frame_sha256: Hash
    box: Box
    text: str = Field(min_length=1, max_length=160)
    field: Literal["name", "score"]

    @model_validator(mode="after")
    def valid_label(self):
        x1, y1, x2, y2 = self.box
        if not 0 <= x1 < x2 <= 1 or not 0 <= y1 < y2 <= 1:
            raise ValueError("invalid_box")
        if any(ord(char) < 32 for char in self.text):
            raise ValueError("invalid_label_text")
        if self.field == "score" and (not self.text.isascii() or not self.text.isdigit()):
            raise ValueError("invalid_score_label")
        return self


class TrainingExample(Contract):
    case_id: Identifier
    recording_group_id: Identifier
    source_sha256: Hash
    lineage_hashes: list[Hash] = Field(default_factory=list, max_length=100)
    split: Literal["train", "validation"]
    frames: list[Frame] = Field(min_length=1, max_length=2000)
    labels: list[CellLabel] = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def registered_evidence(self):
        hashes = {frame.sha256 for frame in self.frames}
        if any(label.frame_sha256 not in hashes for label in self.labels):
            raise ValueError("missing_label_evidence")
        return self


class TrainingRecipe(Contract):
    family: Literal["paddle-v5-mobile-rec"]
    epochs: int = Field(ge=1, le=20)
    batch_size: int = Field(ge=1, le=64)
    learning_rate: float = Field(gt=0, le=0.01)
    seed: int = Field(ge=0, le=2 ** 31 - 1)


class TrainRequest(Contract):
    version: Literal[1]
    dataset_hash: Hash
    score_target: Target
    examples: list[TrainingExample] = Field(min_length=1, max_length=200)
    recipe: TrainingRecipe
    limits: Limits

    @model_validator(mode="after")
    def split_isolation(self):
        splits = {}
        frame_bytes = {}
        for example in self.examples:
            fingerprints = [f"group:{example.recording_group_id}", *[f"hash:{value}" for value in [example.source_sha256, *example.lineage_hashes, *[frame.sha256 for frame in example.frames]]]]
            for key in fingerprints:
                if key in splits and splits[key] != example.split:
                    raise ValueError("split_leakage")
                splits[key] = example.split
            for frame in example.frames:
                if frame.sha256 in frame_bytes and frame_bytes[frame.sha256] != frame.bytes:
                    raise ValueError("artifact_hash_conflict")
                frame_bytes[frame.sha256] = frame.bytes
        if len(frame_bytes) > self.limits.max_frames or sum(frame_bytes.values()) > self.limits.max_input_bytes:
            raise ValueError("input_budget_exceeded")
        if sum(len(example.labels) for example in self.examples) > 10000:
            raise ValueError("label_budget_exceeded")
        if {example.split for example in self.examples} != {"train", "validation"}:
            raise ValueError("training_and_validation_required")
        return self
