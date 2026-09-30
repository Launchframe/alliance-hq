import { parseVsScore } from "@/lib/vs-scores/evidence.shared";
import { validateCaseEvidence } from "./evidence.shared";
import { OcrLearningError, ocrCaseSchema, ocrPredictionSchema, type OcrBox, type OcrCase, type OcrEvidence, type OcrLabel, type OcrPrediction } from "./types.shared";

export function normalizeOcrInteger(value: unknown): string | null {
  try { return String(parseVsScore(value)); } catch { return null; }
}

export function ocrBoxOverlap(a: OcrBox, b: OcrBox): number {
  const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return area > 0 ? intersection / area : 0;
}

function nameKey(name: string): string { return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(); }
function sameIdentity(label: OcrLabel, row: { memberId: string | null; name: string }): boolean { return label.memberId ? row.memberId === label.memberId : nameKey(row.name) === nameKey(label.name); }
function ratio(numerator: number, denominator: number): number | null { return denominator > 0 ? numerator / denominator : null; }

function linkedLabels(evidence: OcrEvidence[], labels: OcrLabel[]): OcrLabel[] {
  return labels.filter((label) => label.evidence.some((truth) => evidence.some((observed) => {
    if (truth.frameSha256 !== observed.frameSha256 || !truth.box || !observed.box) return false;
    if (truth.timestampSeconds !== observed.timestampSeconds) return false;
    return ocrBoxOverlap(truth.box, observed.box) >= 0.5;
  })));
}

function editDistance(a: string, b: string): number {
  const left = Array.from(a.normalize("NFC")), right = Array.from(b.normalize("NFC"));
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++) current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + Number(left[i] !== right[j])));
    previous = current;
  }
  return previous[right.length];
}

export function evaluatePrediction(sampleInput: OcrCase, predictionInput: OcrPrediction, confidenceThreshold = 0.9) {
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) throw new OcrLearningError("invalid_confidence_threshold");
  const sampleResult = ocrCaseSchema.safeParse(sampleInput), result = ocrPredictionSchema.safeParse(predictionInput);
  if (!sampleResult.success || !result.success) throw new OcrLearningError("invalid_manifest");
  const sample = sampleResult.data, prediction = result.data;
  if (sample.state !== "verified" || sample.pairing !== "confirmed" || !sample.privacyReviewed) throw new OcrLearningError("unverified_case");
  if (prediction.synthetic || prediction.engine === "mock") throw new OcrLearningError("synthetic_prediction");
  if (sample.sourceSha256 !== prediction.sourceSha256 || sample.id !== prediction.caseId) throw new OcrLearningError("source_mismatch");
  if (sample.scoreTarget !== prediction.scoreTarget) throw new OcrLearningError("target_mismatch");
  validateCaseEvidence(sample);
  if (sample.durationSeconds != null && prediction.selectedTimestamps.some((time) => time > sample.durationSeconds!)) throw new OcrLearningError("invalid_frame_time");
  const expected = sample.labels.filter((row) => row.readable);
  const remaining = new Set(expected.map((_, index) => index));
  const assignments = new Map<number, number>();
  const ordered = prediction.rows.map((row, index) => ({ row, index })).sort((a, b) => (b.row.confidence ?? -1) - (a.row.confidence ?? -1));
  for (const exactOnly of [true, false]) {
    for (const { row, index } of ordered) {
      if (assignments.has(index)) continue;
      const match = [...remaining].find((candidate) => sameIdentity(expected[candidate], row) && (!exactOnly || expected[candidate].score === normalizeOcrInteger(row.score)));
      if (match != null) { assignments.set(index, match); remaining.delete(match); }
    }
  }
  let exactRows = 0, matchedRows = 0, duplicateRows = 0, identityErrors = 0, identityEvaluatedRows = 0, associationUnknownRows = 0, observedFalseMerges = 0;
  let nameErrors = 0, nameCharacters = 0, scoreMatches = 0, scoreEvaluatedRows = 0;
  let confidentRows = 0, confidentCorrectRows = 0;
  for (const [index, row] of prediction.rows.entries()) {
    const score = normalizeOcrInteger(row.score);
    const matched = assignments.get(index);
    const exact = matched != null && expected[matched].score === score;
    if (matched != null) {
      matchedRows++;
      if (exact) exactRows++;
    } else if (expected.some((label) => sameIdentity(label, row))) duplicateRows++;
    if (row.confidence != null && row.confidence >= confidenceThreshold) {
      confidentRows++;
      if (exact) confidentCorrectRows++;
    }
    const linked = linkedLabels(row.evidence, expected);
    if (!linked.length) associationUnknownRows++;
    if (linked.length > 1) observedFalseMerges++;
    if (linked.length === 1) {
      if (linked[0].memberId) {
        identityEvaluatedRows++;
        if (linked[0].memberId !== row.memberId) identityErrors++;
      }
      nameErrors += editDistance(linked[0].name, row.name);
      nameCharacters += Array.from(linked[0].name.normalize("NFC")).length;
      scoreEvaluatedRows++;
      if (linked[0].score === score) scoreMatches++;
    }
  }
  const coverageKnown = sample.sourceKind === "original_video" && expected.length > 0 && expected.every((row) => row.readableIntervals.length > 0);
  const coveredRows = coverageKnown ? expected.filter((row) => row.readableIntervals.some(({ start, end }) => prediction.selectedTimestamps.some((time) => time >= start && time <= end))).length : null;
  return {
    metricVersion: 1, caseId: sample.id, scoreTarget: sample.scoreTarget, recordingGroupId: sample.recordingGroupId,
    pipelineVersion: prediction.pipelineVersion, engine: prediction.engine, confidenceThreshold,
    expectedRows: expected.length, predictedRows: prediction.rows.length, exactRows, matchedRows,
    exactPrecision: ratio(exactRows, prediction.rows.length), exactRecall: ratio(exactRows, expected.length),
    missingRows: remaining.size, unexpectedRows: prediction.rows.length - matchedRows - duplicateRows, duplicateRows,
    identityErrors: identityEvaluatedRows > 0 ? identityErrors : null, identityEvaluatedRows, associationUnknownRows, observedFalseMerges,
    falseMerges: associationUnknownRows > 0 ? null : observedFalseMerges,
    sourceReadableCoverage: coveredRows == null ? null : ratio(coveredRows, expected.length),
    nameCharacterErrorRate: ratio(nameErrors, nameCharacters), exactScoreAccuracy: ratio(scoreMatches, scoreEvaluatedRows),
    scoreEvaluatedRows, confidentRows, confidentPrecision: ratio(confidentCorrectRows, confidentRows),
    totalMs: prediction.totalMs, requests: prediction.requests, peakMemoryBytes: prediction.peakMemoryBytes,
  };
}

export type OcrMetrics = ReturnType<typeof evaluatePrediction>;
