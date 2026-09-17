import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ocrCaseFixture, ocrPredictionFixture } from "../src/test/ocr-corpus";
import { buildDataset, datasetHash } from "../src/lib/ocr/benchmark/dataset.server";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ocr-cli-"));
  directories.push(directory);
  const sample = ocrCaseFixture("case-a", { expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const dataset = buildDataset(sample.allianceId, [{ sample, split: "test" }], new Date());
  const input = path.join(directory, "dataset.json"), predictions = path.join(directory, "predictions.json");
  await writeFile(input, JSON.stringify(dataset));
  await writeFile(predictions, JSON.stringify([ocrPredictionFixture()]));
  const run = (...args: string[]) => execute(process.execPath, ["--conditions=react-server", "--import=tsx", path.resolve("scripts/ocr-benchmark.ts"), "--dataset", input, "--predictions", predictions, ...args], {
    timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", DATABASE_URL: "", LOCAL_DATABASE_URL: "", E2E_DATABASE_URL: "" },
  });
  return { directory, dataset, input, predictions, run };
}

describe("offline OCR benchmark CLI", () => {
  it("replays frozen inputs without database configuration or player-data output", async () => {
    const f = await fixture();
    const { stdout } = await f.run();
    const report = JSON.parse(stdout);
    expect(report.datasetHash).toBe(datasetHash(f.dataset));
    expect(report.metrics).toMatchObject([{ scoreTarget: "vs-performance", exactRows: 1, exactRecall: 1, split: "test" }]);
    expect(stdout).not.toContain("Álpha");
    expect(report.metrics[0]).not.toHaveProperty("score");
  });

  it("replays attributable worker envelopes but refuses budget-limited sampling", async () => {
    const f = await fixture();
    const receipt = { prediction: ocrPredictionFixture({ engine: "paddleocr" }), workerCodeHash: "c".repeat(64), samplingBudgetLimited: false, samplerFeatures: [], observations: [] };
    await writeFile(f.predictions, JSON.stringify([receipt]));
    const { stdout } = await f.run();
    const report = JSON.parse(stdout);
    expect(report.metrics[0].exactRows).toBe(1);
    expect(report.workerCodeHashes).toEqual([receipt.workerCodeHash]);
    await writeFile(f.predictions, JSON.stringify(receipt));
    expect(JSON.parse((await f.run()).stdout).metrics[0].exactRows).toBe(1);
    await writeFile(f.predictions, JSON.stringify([{ ...receipt, samplingBudgetLimited: true }]));
    await expect(f.run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("sampling_budget_limited") });
  });

  it("refuses to overwrite existing output and preserves its contents", async () => {
    const f = await fixture();
    const before = await readFile(f.input, "utf8");
    await expect(f.run("--out", f.input)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(f.input, "utf8")).toBe(before);
  });

  it("rejects synthetic results and incomplete prediction sets without printing inputs", async () => {
    const f = await fixture();
    await writeFile(f.predictions, JSON.stringify([ocrPredictionFixture({ synthetic: true })]));
    await expect(f.run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("synthetic_prediction") });
    await writeFile(f.predictions, "[]");
    await expect(f.run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("prediction_set_mismatch") });
  });
});
