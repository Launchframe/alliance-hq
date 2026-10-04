import { describe, expect, it } from "vitest";

import { buildDataset, datasetHash } from "./dataset.server";
import { evaluatePrediction } from "./metrics.shared";
import { suggestSourceMatches } from "./pairing.shared";
import { ocrCaseSchema } from "./types.shared";
import { ocrCaseFixture as example, ocrPredictionFixture as prediction, ocrFixtureHash as hash } from "@/test/ocr-corpus";

const now = new Date("2026-09-12T12:00:00.000Z");

describe("OCR corpus contracts", () => {
  it("accepts explicit zero, Unicode names and Kills as a separate target", () => {
    const row = example();
    row.scoreTarget = "alliance-kills-video";
    row.labels[0].score = "0";
    expect(ocrCaseSchema.parse(row)).toMatchObject({ scoreTarget: "alliance-kills-video", labels: [{ name: "Álpha", score: "0" }] });
  });

  it("rejects invalid geometry, noninteger values and synthetic frame provenance", () => {
    const row = example();
    expect(ocrCaseSchema.safeParse({ ...row, labels: [{ ...row.labels[0], score: "1.5" }] }).success).toBe(false);
    expect(ocrCaseSchema.safeParse({ ...row, labels: [{ ...row.labels[0], evidence: [{ frameIndex: -1 }] }] }).success).toBe(false);
    expect(ocrCaseSchema.safeParse({ ...row, labels: [{ ...row.labels[0], evidence: [{ ...row.labels[0].evidence[0], box: [0.8, 0.1, 0.2, 0.3] }] }] }).success).toBe(false);
  });

  it("never accepts arbitrary storage paths or unknown privacy fields", () => {
    const row = example();
    expect(ocrCaseSchema.safeParse({ ...row, frames: [{ ...row.frames[0], storageKey: "ocr-learning/../../secrets" }] }).success).toBe(false);
    expect(ocrCaseSchema.safeParse({ ...row, gameUid: "private-account-binding" }).success).toBe(false);
  });
});

describe("immutable recording-level datasets", () => {
  it("sorts cases and produces a reproducible content hash", () => {
    const a = example();
    const b = example("case-b", { sourceSha256: hash("c"), lineageHashes: [hash("c")] });
    b.frames[0] = { ...b.frames[0], sha256: hash("d"), storageKey: "ocr-learning/alliance-a/case-b/frame.png" };
    b.labels[0].evidence[0].frameSha256 = hash("d");
    const one = buildDataset("alliance-a", [{ sample: a, split: "train" }, { sample: b, split: "test" }], now);
    const two = buildDataset("alliance-a", [{ sample: b, split: "test" }, { sample: a, split: "train" }], now);
    expect(datasetHash(one)).toBe(datasetHash(two));
    expect(one.entries.map((entry) => entry.sample.id)).toEqual(["case-a", "case-b"]);
    b.labelRevision = 2;
    expect(datasetHash(buildDataset("alliance-a", [{ sample: b, split: "test" }, { sample: a, split: "train" }], now))).not.toBe(datasetHash(one));
  });

  it.each(["candidate", "excluded", "revoked"] as const)("rejects %s labels", (state) => {
    expect(() => buildDataset("alliance-a", [{ sample: example("a", { state }), split: "train" }], now)).toThrow("unverified_case");
  });

  it("rejects unconfirmed pairing, expired cases and foreign tenants", () => {
    expect(() => buildDataset("alliance-a", [{ sample: example("a", { pairing: "unmatched" }), split: "train" }], now)).toThrow("unconfirmed_source");
    expect(() => buildDataset("alliance-a", [{ sample: example("a", { expiresAt: "2026-09-01T00:00:00.000Z" }), split: "train" }], now)).toThrow("expired_case");
    expect(() => buildDataset("alliance-b", [{ sample: example(), split: "train" }], now)).toThrow("tenant_mismatch");
  });

  it("rejects group, image and transformed-source leakage across splits", () => {
    const a = example();
    const b = example("case-b", { sourceSha256: hash("c"), lineageHashes: [hash("c")] });
    expect(() => buildDataset("alliance-a", [{ sample: a, split: "train" }, { sample: b, split: "test" }], now)).toThrow("split_leakage");
    b.frames = [{ ...b.frames[0], sha256: hash("d") }];
    b.labels[0].evidence = [{ ...b.labels[0].evidence[0], frameSha256: hash("d") }];
    b.recordingGroupId = a.recordingGroupId;
    expect(() => buildDataset("alliance-a", [{ sample: a, split: "train" }, { sample: b, split: "test" }], now)).toThrow("split_leakage");
    b.recordingGroupId = "other-group";
    b.lineageHashes.push(a.sourceSha256);
    expect(() => buildDataset("alliance-a", [{ sample: a, split: "train" }, { sample: b, split: "test" }], now)).toThrow("split_leakage");
  });

  it("requires real registered pixels for readable training labels", () => {
    const row = example();
    row.labels[0].evidence[0].frameSha256 = hash("f");
    expect(() => buildDataset("alliance-a", [{ sample: row, split: "train" }], now)).toThrow("missing_evidence");
  });
});

describe("exact-row evaluation", () => {
  it("measures exact values, visual association and source-readable coverage", () => {
    expect(evaluatePrediction(example(), prediction())).toMatchObject({ expectedRows: 1, predictedRows: 1, exactRows: 1, exactPrecision: 1, exactRecall: 1, sourceReadableCoverage: 1, falseMerges: 0, associationUnknownRows: 0 });
  });

  it("penalizes duplicate rows and preserves legitimate equal-score players", () => {
    const sample = example();
    const beta = { ...sample.labels[0], id: "row-b", name: "Beta", memberId: "member-b", evidence: [{ frameSha256: hash("b"), timestampSeconds: 1, box: [0.1, 0.3, 0.9, 0.4] as [number, number, number, number] }] };
    sample.labels.push(beta);
    const output = prediction();
    output.rows.push({ ...output.rows[0], name: "Beta", memberId: "member-b", evidence: beta.evidence });
    output.rows.push({ ...output.rows[0] });
    expect(evaluatePrediction(sample, output)).toMatchObject({ exactRows: 2, expectedRows: 2, predictedRows: 3, duplicateRows: 1, exactRecall: 1, exactPrecision: 2 / 3 });
  });

  it("does not call a misassigned score correct merely because it matches a roster member", () => {
    const output = prediction();
    output.rows[0].memberId = "different-member";
    expect(evaluatePrediction(example(), output)).toMatchObject({ exactRows: 0, identityErrors: 1, sourceReadableCoverage: 1 });
  });

  it("reports absent coverage and visual evidence as unknown, not a passing zero-error rate", () => {
    const sample = example();
    sample.labels[0].readableIntervals = [];
    const output = prediction();
    output.rows[0].evidence = [];
    expect(evaluatePrediction(sample, output)).toMatchObject({ sourceReadableCoverage: null, falseMerges: null, associationUnknownRows: 1 });
  });

  it("is independent of conflicting duplicate prediction order", () => {
    const output = prediction();
    output.rows.unshift({ ...output.rows[0], score: "999" });
    const forward = evaluatePrediction(example(), output);
    const reverse = evaluatePrediction(example(), { ...output, rows: [...output.rows].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({ exactRows: 1, exactPrecision: 0.5, duplicateRows: 1 });
  });

  it("counts cross-row fusion and does not mistake missing identity labels for zero errors", () => {
    const sample = example();
    const evidence = { frameSha256: hash("b"), timestampSeconds: 1, box: [0.1, 0.3, 0.9, 0.4] as [number, number, number, number] };
    sample.labels.push({ ...sample.labels[0], id: "second", name: "Beta", memberId: "member-b", evidence: [evidence] });
    const output = prediction();
    output.rows[0].evidence.push(evidence);
    expect(evaluatePrediction(sample, output)).toMatchObject({ falseMerges: 1, missingRows: 1 });
    const noIdentity = example();
    noIdentity.labels[0].memberId = null;
    expect(evaluatePrediction(noIdentity, prediction())).toMatchObject({ exactRows: 1, identityErrors: null, identityEvaluatedRows: 0 });
  });

  it("keeps archive coverage unknown and evaluates the requested confidence threshold", () => {
    expect(evaluatePrediction(example("case-a", { sourceKind: "playback_archive" }), prediction())).toMatchObject({ sourceReadableCoverage: null });
    expect(evaluatePrediction(example(), prediction(), 0.99)).toMatchObject({ confidentRows: 0, confidentPrecision: null });
    expect(() => evaluatePrediction(example(), prediction(), Number.NaN)).toThrow("invalid_confidence_threshold");
  });

  it("rejects mock, source and target mismatches", () => {
    expect(() => evaluatePrediction(example(), prediction({ synthetic: true }))).toThrow("synthetic_prediction");
    expect(() => evaluatePrediction(example(), prediction({ sourceSha256: hash("f") }))).toThrow("source_mismatch");
    expect(() => evaluatePrediction(example(), prediction({ scoreTarget: "alliance-kills-video" }))).toThrow("target_mismatch");
  });
});

describe("source pairing suggestions", () => {
  it("requires confirmation even when metadata is identical and excludes foreign targets/tenants", () => {
    const source = { allianceId: "alliance-a", scoreTarget: "vs-performance" as const, fileName: "Friday.mp4", bytes: 1000, durationSeconds: 10 };
    const jobs = [
      { ...source, id: "job-a" },
      { ...source, id: "foreign", allianceId: "alliance-b" },
      { ...source, id: "kills", scoreTarget: "alliance-kills-video" as const },
    ];
    expect(suggestSourceMatches(source, jobs)).toEqual([expect.objectContaining({ jobId: "job-a", requiresConfirmation: true })]);
  });
});
