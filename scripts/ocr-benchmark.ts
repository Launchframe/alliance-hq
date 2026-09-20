import { open, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";

import { buildDataset, datasetHash, stableJson } from "../src/lib/ocr/benchmark/dataset.server";
import { evaluatePrediction } from "../src/lib/ocr/benchmark/metrics.shared";
import { OcrLearningError, ocrDatasetSchema, ocrPredictionSchema } from "../src/lib/ocr/benchmark/types.shared";
import { workerInferenceResultSchema } from "../src/lib/ocr/learning/worker.shared";

async function readJson(file: string, limit = 32 * 1024 * 1024): Promise<unknown> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new OcrLearningError("input_limit");
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new OcrLearningError("input_changed");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)));
  } finally { await handle.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    dataset: { type: "string" }, predictions: { type: "string" }, out: { type: "string" },
    "confidence-threshold": { type: "string", default: "0.9" },
  }, strict: true });
  if (!values.dataset || !values.predictions) throw new OcrLearningError("dataset_and_predictions_required");
  const input = ocrDatasetSchema.safeParse(await readJson(values.dataset));
  const rawOutputs = await readJson(values.predictions);
  const outputs = z.array(z.union([workerInferenceResultSchema, ocrPredictionSchema])).max(2000).safeParse(Array.isArray(rawOutputs) ? rawOutputs : [rawOutputs]);
  if (!input.success || !outputs.success) throw new OcrLearningError("invalid_manifest");
  const dataset = buildDataset(input.data.allianceId, input.data.entries, new Date());
  const workerCodeHashes = new Set<string>();
  const predictions = outputs.data.map((output) => {
    if (!("prediction" in output)) return output;
    if (output.samplingBudgetLimited) throw new OcrLearningError("sampling_budget_limited");
    workerCodeHashes.add(output.workerCodeHash);
    return output.prediction;
  });
  const byId = new Map(predictions.map((row) => [row.caseId, row]));
  if (byId.size !== predictions.length || dataset.entries.length !== byId.size) throw new OcrLearningError("prediction_set_mismatch");
  const metrics = dataset.entries.map(({ sample, split }) => {
    const prediction = byId.get(sample.id);
    if (!prediction) throw new OcrLearningError("prediction_set_mismatch");
    return { split, ...evaluatePrediction(sample, prediction, Number(values["confidence-threshold"])) };
  });
  const report = stableJson({ version: 1, datasetHash: datasetHash(dataset), evaluatedAt: new Date().toISOString(), workerCodeHashes: [...workerCodeHashes].sort(), metrics });
  if (values.out) await writeFile(values.out, `${report}\n`, { flag: "wx", mode: 0o600 });
  else process.stdout.write(`${report}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error instanceof OcrLearningError ? error.code : "benchmark_failed" })}\n`);
  process.exitCode = 1;
});
