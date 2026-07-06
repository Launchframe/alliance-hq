/**
 * Tesseract.js integration for roster OCR.
 *
 * Uses a lazy-initialised worker so the heavy WASM + traineddata load happens
 * only on the first call.  The worker is reused across calls within the same
 * Node.js process lifetime.
 *
 * Language data (eng.traineddata.gz):
 *  - **Default:** omit `langPath` so tesseract.js downloads from jsDelivr CDN.
 *  - **Override:** set `TESSERACT_LANG_PATH` to a local directory containing
 *    `eng.traineddata.gz`, or a CDN base URL (must end without trailing slash).
 *  - Do **not** point at `tesseract.js-core` — that package ships WASM only, no
 *    traineddata files (tesseract.js v7+).
 */

import { createRequire } from "node:module";

import { createWorker, type Worker } from "tesseract.js";

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";

const require = createRequire(import.meta.url);

let workerInstance: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;
/** Serialize recognize() — tesseract.js workers are not safe for concurrent use. */
let recognizeChain: Promise<unknown> = Promise.resolve();

function resolveTesseractWorkerPath(): string {
  return require.resolve("tesseract.js/src/worker-script/node/index.js");
}

/** Optional worker options — only set langPath when explicitly configured. */
export function buildTesseractWorkerOptions(): {
  workerPath: string;
  langPath?: string;
  logger?: typeof console.log;
} {
  const options: {
    workerPath: string;
    langPath?: string;
    logger?: typeof console.log;
  } = {
    workerPath: resolveTesseractWorkerPath(),
    logger: process.env.NODE_ENV === "development" ? console.log : undefined,
  };

  const langPath = process.env.TESSERACT_LANG_PATH?.trim();
  if (langPath) {
    options.langPath = langPath;
  }

  return options;
}

async function getWorker(): Promise<Worker> {
  if (workerInstance) {
    return workerInstance;
  }
  if (!workerInitPromise) {
    workerInitPromise = createWorker("eng", 1, buildTesseractWorkerOptions()).then(
      (worker) => {
        workerInstance = worker;
        return worker;
      },
    );
  }
  return workerInitPromise;
}

export type OcrLineResult = {
  text: string;
  /** Tesseract confidence 0–100. */
  confidence: number;
};

/**
 * Run Tesseract on a pre-processed PNG buffer and return individual text lines.
 *
 * PSM 6 (single uniform block of text) works well for roster screenshots.
 */
export async function runTesseract(
  imageBuffer: Buffer,
  config: Partial<RosterOcrConfig> = {},
): Promise<OcrLineResult[]> {
  const run = async (): Promise<OcrLineResult[]> => {
    const psm = config.tesseractPsm ?? DEFAULT_ROSTER_OCR_CONFIG.tesseractPsm ?? 6;
    const minConf =
      config.minWordConfidence ??
      DEFAULT_ROSTER_OCR_CONFIG.minWordConfidence ??
      40;

    const worker = await getWorker();

    await worker.setParameters({
      tessedit_pageseg_mode: String(psm) as Parameters<
        typeof worker.setParameters
      >[0]["tessedit_pageseg_mode"],
      ...(config.charWhitelist
        ? { tessedit_char_whitelist: config.charWhitelist }
        : {}),
    });

    const { data } = await worker.recognize(imageBuffer);

    const lines: OcrLineResult[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          const text = line.text.replace(/\n/g, " ").trim();
          if (!text) continue;
          const conf = line.confidence ?? 0;
          if (conf < minConf) continue;
          lines.push({ text, confidence: conf });
        }
      }
    }

    return lines;
  };

  const result = recognizeChain.then(run, run);
  recognizeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Terminate the worker. Call during graceful shutdown if needed. */
export async function terminateTesseractWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    workerInitPromise = null;
    recognizeChain = Promise.resolve();
  }
}
