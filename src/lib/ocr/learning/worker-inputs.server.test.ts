import { describe, expect, it } from "vitest";
import { ocrCaseFixture, ocrFixtureHash } from "@/test/ocr-corpus";
import { buildDataset, datasetHash } from "../benchmark/dataset.server";
import { buildWorkerInference, buildWorkerTraining } from "./worker-inputs.server";
import { defaultWorkerLimits, workerInferenceSchema, workerSamplerSchema, workerTrainingSchema } from "./worker.shared";

const now = new Date("2026-09-12T00:00:00Z");
const recipe = { family: "paddle-v5-mobile-rec" as const, epochs: 1, batchSize: 2, learningRate: 0.00001, seed: 7 };
const sampler = workerSamplerSchema.parse({ mode: "all" });

function fixture() {
  const cases = ["a", "c", "e"].map((hash, index) => {
    const sample = ocrCaseFixture(`case-${index}`, { sourceSha256: ocrFixtureHash(hash), lineageHashes: [ocrFixtureHash(hash)] });
    sample.frames[0].sha256 = ocrFixtureHash(["b", "d", "f"][index]);
    sample.labels[0].evidence[0].frameSha256 = sample.frames[0].sha256;
    sample.labels[0].name = ["TRAIN_ONLY", "VALIDATION_ONLY", "HELD_OUT_ONLY"][index];
    return sample;
  });
  const dataset = buildDataset("alliance-a", cases.map((sample, index) => ({ sample, split: (["train", "validation", "test"] as const)[index] })), now);
  return { dataset, sizes: new Map(cases.map((sample) => [sample.frames[0].sha256, 1000])) };
}

describe("worker input boundaries", () => {
  it("does not give inference expected labels, identities or answer boxes", () => {
    const f = fixture();
    const input = buildWorkerInference(f.dataset, "case-2", f.sizes, { pipelineVersion: "candidate", sampler, now });
    expect(input.roster).toEqual([]);
    expect(input).not.toHaveProperty("labels");
    expect(JSON.stringify(input)).not.toContain("HELD_OUT_ONLY");
    expect(JSON.stringify(input)).not.toContain("member-a");
    expect(JSON.stringify(input)).not.toContain("nameBox");
    expect(workerInferenceSchema.safeParse({ ...input, labels: [] }).success).toBe(false);
  });

  it("exports only train/validation glyph crops with explicit cell evidence", () => {
    const f = fixture();
    const input = buildWorkerTraining(f.dataset, "vs-performance", f.sizes, recipe, defaultWorkerLimits, now);
    expect(input.datasetHash).toBe(datasetHash(f.dataset));
    expect(input.examples.map((example) => example.split)).toEqual(["train", "validation"]);
    expect(input.examples[0].labels).toHaveLength(2);
    expect(JSON.stringify(input)).not.toContain("HELD_OUT_ONLY");
    expect(JSON.stringify(input)).not.toContain("member-a");
    expect(workerTrainingSchema.safeParse(input).success).toBe(true);
    const invalid = structuredClone(input);
    invalid.examples[1].lineageHashes.push(invalid.examples[0].sourceSha256);
    expect(workerTrainingSchema.safeParse(invalid).success).toBe(false);
  });

  it("does not substitute row boxes for missing name/score annotations", () => {
    const f = fixture();
    delete f.dataset.entries[0].sample.labels[0].evidence[0].nameBox;
    expect(() => buildWorkerTraining(f.dataset, "vs-performance", f.sizes, recipe, defaultWorkerLimits, now)).toThrow("cell_annotations_required");
  });

  it("rejects expired, unverified and unbounded inputs before handing off pixels", () => {
    const f = fixture();
    expect(() => buildWorkerInference(f.dataset, "case-0", new Map(), { pipelineVersion: "candidate", sampler, now })).toThrow("invalid_worker_frame");
    f.dataset.entries[0].sample.privacyReviewed = false;
    expect(() => buildWorkerTraining(f.dataset, "vs-performance", f.sizes, recipe, defaultWorkerLimits, now)).toThrow("data_permission_required");
    f.dataset.entries[0].sample.privacyReviewed = true;
    f.dataset.entries[0].sample.expiresAt = "2000-01-01T00:00:00Z";
    expect(() => buildWorkerTraining(f.dataset, "vs-performance", f.sizes, recipe, defaultWorkerLimits, now)).toThrow("expired_case");
  });
});
