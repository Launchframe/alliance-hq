import type { OcrCase, OcrPrediction } from "@/lib/ocr/benchmark/types.shared";

export const ocrFixtureHash = (value: string) => value.repeat(64);

export function ocrCaseFixture(id = "case-a", overrides: Partial<OcrCase> = {}): OcrCase {
  const allianceId = overrides.allianceId ?? "alliance-a";
  return {
    id, allianceId, scoreTarget: "vs-performance", recordingGroupId: id,
    sourceSha256: ocrFixtureHash("a"), lineageHashes: [ocrFixtureHash("a")], sourceKind: "original_video",
    jobId: "job-a", pairing: "confirmed", state: "verified", labelRevision: 1,
    privacyReviewed: true, externalTrainingAllowed: false,
    expiresAt: "2026-10-01T00:00:00.000Z", durationSeconds: 10,
    context: { recordedDate: "2026-09-11", vsPeriod: "daily", language: "en-US" },
    frames: [{ sha256: ocrFixtureHash("b"), storageKey: `ocr-learning/${allianceId}/${id}/frame.png`, timestampSeconds: 1, width: 1000, height: 1000 }],
    labels: [{
      id: "row-a", name: "Álpha", score: "1234567", memberId: "member-a", rank: 1,
      readable: true, evidence: [{ frameSha256: ocrFixtureHash("b"), timestampSeconds: 1, box: [0.1, 0.1, 0.9, 0.2], nameBox: [0.2, 0.1, 0.5, 0.2], scoreBox: [0.6, 0.1, 0.9, 0.2] }],
      readableIntervals: [{ start: 0.5, end: 1.5 }],
    }],
    ...overrides,
  };
}

export function ocrPredictionFixture(overrides: Partial<OcrPrediction> = {}): OcrPrediction {
  return {
    version: 1, caseId: "case-a", scoreTarget: "vs-performance", sourceSha256: ocrFixtureHash("a"),
    pipelineVersion: "baseline-v1", engine: "tesseract", synthetic: false,
    selectedTimestamps: [1], totalMs: 100, requests: 1, peakMemoryBytes: null,
    rows: [{ name: "Álpha", score: "1234567", memberId: "member-a", confidence: 0.95, evidence: ocrCaseFixture().labels[0].evidence }],
    ...overrides,
  };
}
