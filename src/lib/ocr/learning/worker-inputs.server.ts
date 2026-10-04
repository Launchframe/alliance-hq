import "server-only";

import { buildDataset, datasetHash } from "../benchmark/dataset.server";
import { OcrLearningError, ocrDatasetSchema, type OcrCase, type OcrDataset, type OcrTarget } from "../benchmark/types.shared";
import { defaultWorkerLimits, workerFrameSchema, workerInferenceSchema, workerTrainingSchema, type WorkerFrame, type WorkerInference, type WorkerLimits, type WorkerRecipe, type WorkerSampler, type WorkerTraining } from "./worker.shared";

function checkedDataset(input: OcrDataset, now: Date) {
  const parsed = ocrDatasetSchema.safeParse(input);
  if (!parsed.success) throw new OcrLearningError("invalid_manifest");
  return buildDataset(parsed.data.allianceId, parsed.data.entries, now);
}

function framesFor(sample: OcrCase, sizes: ReadonlyMap<string, number>, required?: Set<string>): WorkerFrame[] {
  return sample.frames.filter((frame) => !required || required.has(frame.sha256)).map((frame) => {
    const parsed = workerFrameSchema.safeParse({ sha256: frame.sha256, bytes: sizes.get(frame.sha256), timestampSeconds: frame.timestampSeconds, width: frame.width, height: frame.height });
    if (!parsed.success) throw new OcrLearningError("invalid_worker_frame");
    return parsed.data;
  });
}

export function buildWorkerInference(input: OcrDataset, caseId: string, sizes: ReadonlyMap<string, number>, options: {
  pipelineVersion: string; roster?: WorkerInference["roster"]; sampler: WorkerSampler; limits?: WorkerLimits; now?: Date;
}): WorkerInference {
  const dataset = checkedDataset(input, options.now ?? new Date());
  const sample = dataset.entries.find((entry) => entry.sample.id === caseId)?.sample;
  if (!sample) throw new OcrLearningError("case_not_found", 404);
  const parsed = workerInferenceSchema.safeParse({ version: 1, caseId: sample.id, scoreTarget: sample.scoreTarget, sourceSha256: sample.sourceSha256,
    pipelineVersion: options.pipelineVersion, frames: framesFor(sample, sizes), roster: options.roster ?? [], sampler: options.sampler, limits: options.limits ?? defaultWorkerLimits });
  if (!parsed.success) throw new OcrLearningError("invalid_worker_input");
  return parsed.data;
}

export function buildWorkerTraining(input: OcrDataset, target: OcrTarget, sizes: ReadonlyMap<string, number>, recipe: WorkerRecipe, limits: WorkerLimits = defaultWorkerLimits, now = new Date()): WorkerTraining {
  const dataset = checkedDataset(input, now);
  const entries = dataset.entries.filter((entry) => entry.sample.scoreTarget === target && entry.split !== "test");
  const examples = entries.map(({ sample, split }) => {
    const labels: WorkerTraining["examples"][number]["labels"] = [];
    for (const label of sample.labels) {
      if (!label.readable) continue;
      const evidence = label.evidence.filter((item) => item.nameBox && item.scoreBox);
      if (!evidence.length || label.score === null) throw new OcrLearningError("cell_annotations_required");
      for (const item of evidence) {
        labels.push({ frameSha256: item.frameSha256, box: item.nameBox!, text: label.name, field: "name" });
        labels.push({ frameSha256: item.frameSha256, box: item.scoreBox!, text: label.score, field: "score" });
      }
    }
    return { caseId: sample.id, recordingGroupId: sample.recordingGroupId, sourceSha256: sample.sourceSha256, lineageHashes: sample.lineageHashes,
      split, frames: framesFor(sample, sizes, new Set(labels.map((label) => label.frameSha256))), labels };
  });
  const parsed = workerTrainingSchema.safeParse({ version: 1, datasetHash: datasetHash(dataset), scoreTarget: target, examples, recipe, limits });
  if (!parsed.success) throw new OcrLearningError("invalid_worker_training_input");
  return parsed.data;
}
