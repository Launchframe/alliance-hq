import { OcrLearningError, type OcrCase } from "./types.shared";

export function validateCaseEvidence(sample: OcrCase): void {
  if (!sample.frames.length) throw new OcrLearningError("missing_evidence");
  if (sample.frames.some((frame) => !frame.storageKey.startsWith(`ocr-learning/${sample.allianceId}/`))) throw new OcrLearningError("tenant_mismatch", 403);
  const ids = new Set<string>();
  for (const row of sample.labels) {
    if (ids.has(row.id)) throw new OcrLearningError("duplicate_label");
    ids.add(row.id);
    if (row.readable && !row.evidence.length) throw new OcrLearningError("missing_evidence");
    for (const evidence of row.evidence) {
      const frame = sample.frames.find((frame) => frame.sha256 === evidence.frameSha256 && frame.timestampSeconds === evidence.timestampSeconds);
      if (!frame || row.readable && !evidence.box) throw new OcrLearningError("missing_evidence");
      for (const box of [evidence.nameBox, evidence.scoreBox]) {
        const outer = evidence.box;
        if (box && (!outer || box[0] < outer[0] || box[1] < outer[1] || box[2] > outer[2] || box[3] > outer[3])) throw new OcrLearningError("invalid_field_box");
      }
    }
    if (row.readableIntervals.some((interval) => sample.durationSeconds == null || interval.end > sample.durationSeconds)) throw new OcrLearningError("invalid_interval");
  }
  if (sample.frames.some((frame) => frame.timestampSeconds != null && (sample.durationSeconds == null || frame.timestampSeconds > sample.durationSeconds))) throw new OcrLearningError("invalid_frame_time");
}
