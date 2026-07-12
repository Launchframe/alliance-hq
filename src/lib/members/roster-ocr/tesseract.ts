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

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createWorker, type Worker } from "tesseract.js";

import { extractOcrLinesFromTesseractData } from "@/lib/members/roster-ocr/tesseract-lines.shared";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";

const require = createRequire(import.meta.url);

let workerInstance: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;
/** Serialize recognize() — tesseract.js workers are not safe for concurrent use. */
let recognizeChain: Promise<unknown> = Promise.resolve();

/**
 * Absolute filesystem path to the Node worker entry.
 *
 * Never `require.resolve` the worker script itself: Turbopack rewrites that call
 * to a numeric module id, and `worker_threads.Worker(18409)` throws
 * ERR_INVALID_ARG_TYPE ("filename" must be string | URL).
 */
export function resolveTesseractWorkerPath(): string {
  const candidates: string[] = [
    path.join(
      process.cwd(),
      "node_modules/tesseract.js/src/worker-script/node/index.js",
    ),
  ];

  try {
    const pkgJson = require.resolve("tesseract.js/package.json");
    if (typeof pkgJson === "string") {
      candidates.unshift(
        path.join(path.dirname(pkgJson), "src/worker-script/node/index.js"),
      );
    }
  } catch {
    // Fall through to cwd candidate (Vercel NFT / local install layouts).
  }

  for (const workerPath of candidates) {
    if (existsSync(workerPath)) {
      return workerPath;
    }
  }

  throw new Error(
    `tesseract worker script missing (tried: ${candidates.join(", ")})`,
  );
}

/** createWorker always invokes logger on progress — never pass undefined. */
const noopTesseractLogger = (): void => undefined;

/** Optional worker options — only set langPath when explicitly configured. */
export function buildTesseractWorkerOptions(): {
  workerPath: string;
  langPath?: string;
  logger: (message: unknown) => void;
} {
  const workerPath = resolveTesseractWorkerPath();
  if (typeof workerPath !== "string") {
    throw new Error(
      `tesseract workerPath must be a filesystem string (got ${typeof workerPath})`,
    );
  }

  const options: {
    workerPath: string;
    langPath?: string;
    logger: (message: unknown) => void;
  } = {
    workerPath,
    // Prod used to omit logger; createWorker still calls logger(progress) and
    // throws TypeError: logger is not a function (crashes the Discord lambda).
    logger:
      process.env.NODE_ENV === "development" ? console.log : noopTesseractLogger,
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
 *
 * tesseract.js v7 defaults recognize() output to `text` only — we must request
 * `blocks` or line iteration yields nothing even when OCR succeeded.
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

    const { data } = await worker.recognize(
      imageBuffer,
      {},
      { text: true, blocks: true },
    );

    return extractOcrLinesFromTesseractData(data, minConf);
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
  const pendingInit = workerInitPromise;
  workerInitPromise = null;
  recognizeChain = Promise.resolve();

  let worker = workerInstance;
  workerInstance = null;

  if (!worker && pendingInit) {
    try {
      worker = await pendingInit;
    } catch {
      return;
    }
  }

  if (worker) {
    await worker.terminate();
  }
}
