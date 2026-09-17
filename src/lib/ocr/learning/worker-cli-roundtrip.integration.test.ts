import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ocrCaseFixture } from "@/test/ocr-corpus";
import { buildDataset } from "../benchmark/dataset.server";
import { evaluatePrediction } from "../benchmark/metrics.shared";
import { buildWorkerInference } from "./worker-inputs.server";
import { workerInferenceResultSchema, workerSamplerSchema } from "./worker.shared";

const enabled = Boolean(process.env.OCR_WORKER_PYTHON && process.env.OCR_WORKER_MODELS);

describe.skipIf(!enabled)("real Python worker contract round trip", () => {
  it("takes answer-free TypeScript inputs and returns grader-compatible real OCR evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ocr-worker-roundtrip-"));
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="220"><rect width="1000" height="220" fill="white"/><g font-family="sans-serif" font-size="48" fill="black"><text x="40" y="115">ALPHA</text><text x="550" y="115">1234567</text></g></svg>';
      const image = await sharp(Buffer.from(svg)).png().toBuffer();
      const sha256 = createHash("sha256").update(image).digest("hex");
      const sample = ocrCaseFixture("case-roundtrip", { sourceSha256: sha256, lineageHashes: [sha256], sourceKind: "extracted_frame", durationSeconds: null, expiresAt: new Date(Date.now() + 86400000).toISOString() });
      sample.frames = [{ sha256, storageKey: `ocr-learning/${sample.allianceId}/${sample.id}/frame.png`, width: 1000, height: 220, timestampSeconds: null }];
      sample.labels[0] = { ...sample.labels[0], name: "ALPHA", evidence: [{ frameSha256: sha256, timestampSeconds: null, box: [0.02, 0.2, 0.85, 0.7] }], readableIntervals: [] };
      const dataset = buildDataset(sample.allianceId, [{ sample, split: "test" }], new Date());
      const input = buildWorkerInference(dataset, sample.id, new Map([[sha256, image.length]]), { pipelineVersion: "paddle-roundtrip", sampler: workerSamplerSchema.parse({ mode: "all" }), roster: [{ memberId: "member-a", name: "ALPHA", aliases: [] }] });
      const request = path.join(directory, "request.json"), result = path.join(directory, "result.json");
      await writeFile(path.join(directory, `${sha256}.bin`), image);
      await writeFile(request, JSON.stringify(input), { mode: 0o600 });
      await promisify(execFile)(process.env.OCR_WORKER_PYTHON!, ["-m", "ocr_worker", "infer", "--input", request, "--assets", directory, "--models", process.env.OCR_WORKER_MODELS!, "--output", result], {
        cwd: path.resolve("workers/ocr"), timeout: 60000,
        env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: "test", PYTHONNOUSERSITE: "1", OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2" },
      });
      const output = workerInferenceResultSchema.parse(JSON.parse(await readFile(result, "utf8")));
      expect(output.prediction.synthetic).toBe(false);
      expect(output.prediction.engine).toBe("paddleocr");
      expect(output.prediction.rows[0].memberId).toBe("member-a");
      expect(evaluatePrediction(sample, output.prediction).exactRows).toBe(1);
      expect(output.workerCodeHash).toMatch(/^[a-f0-9]{64}$/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 90000);
});
