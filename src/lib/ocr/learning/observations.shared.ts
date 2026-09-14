import type { OcrTarget } from "../benchmark/types.shared";
import type { ReviewRowSnapshot } from "./feedback.shared";
import type { OcrEntry } from "@/lib/video/normalize-rows";

export function isLearningTarget(target: string): target is OcrTarget {
  return target === "vs-performance" || target === "alliance-kills-video";
}

export type OcrRunFrame = {
  index: number;
  sha256: string;
  storageKey: string;
  bytes: number;
  timestampSeconds: number | null;
  timestampProvenance: "legacy_extractor";
};

export type OcrObservation = {
  id: string;
  stage: "parsed_frame_entry";
  frameIndex: number | null;
  frameSha256: string | null;
  name: string;
  scoreText: string;
  rank: number | null;
  truncated: boolean;
};

export type OcrRunManifest = {
  version: 1;
  engine: string;
  codeRevision: string | null;
  requestedExtraction: { mode: string | null; sceneThreshold: number | null; sampleFps: number | null; supplementFps: number | null };
  sourceSha256: string | null;
  sourceKind: "original_video" | "playback_archive" | "unknown";
  synthetic: boolean;
  frames: OcrRunFrame[];
  observations: OcrObservation[];
  observationsTruncated: boolean;
  initialRows: ReviewRowSnapshot[];
  initialRowsTruncated: boolean;
};

export function buildObservations(entries: readonly OcrEntry[], frames: readonly OcrRunFrame[]) {
  const hashes = new Map(frames.map((frame) => [frame.index, frame.sha256]));
  const observations = entries.slice(0, 20000).map((entry, index) => {
    const name = String(entry.name ?? ""), scoreText = String(entry.score ?? "");
    const frameIndex = entry._sourceFrameIndex != null && Number.isSafeInteger(entry._sourceFrameIndex) && entry._sourceFrameIndex >= 0 ? entry._sourceFrameIndex : null;
    return {
      id: `observation-${index}`, stage: "parsed_frame_entry" as const, frameIndex, frameSha256: frameIndex == null ? null : hashes.get(frameIndex) ?? null,
      name: name.slice(0, 160), scoreText: scoreText.slice(0, 128),
      rank: entry.rank != null && Number.isSafeInteger(entry.rank) && entry.rank > 0 ? entry.rank : null,
      truncated: name.length > 160 || scoreText.length > 128,
    };
  });
  return { observations, observationsTruncated: entries.length > 20000 || observations.some((row) => row.truncated) };
}
