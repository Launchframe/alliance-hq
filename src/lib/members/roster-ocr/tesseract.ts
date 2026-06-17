/**
 * Tesseract.js integration for roster OCR.
 *
 * Uses a lazy-initialised worker so the heavy WASM + traineddata load happens
 * only on the first call.  The worker is reused across calls within the same
 * Node.js process lifetime.
 *
 * traineddata path strategy for Vercel:
 *  - Vercel bundles the file-system path at build time via next.config outputFileTracing.
 *  - We resolve the path relative to the module so it works in both dev and prod.
 *  - The `langPath` option tells Tesseract where to find *.traineddata files.
 *    Set TESSERACT_LANG_PATH env var to override (e.g. for lambda layer deployments).
 */

import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";

let workerInstance: Worker | null = null;

/** Resolve traineddata directory.  Override with TESSERACT_LANG_PATH for Vercel. */
function resolveLangPath(): string {
  if (process.env.TESSERACT_LANG_PATH) {
    return process.env.TESSERACT_LANG_PATH;
  }
  // node_modules/tesseract.js-core ships traineddata under tessdata/
  // In Vercel's bundled output the package is available at the same location.
  return path.join(
    path.dirname(require.resolve("tesseract.js")),
    "../tesseract.js-core",
  );
}

async function getWorker(): Promise<Worker> {
  if (!workerInstance) {
    workerInstance = await createWorker("eng", 1, {
      langPath: resolveLangPath(),
      // Suppress tesseract.js internal progress logs in prod
      logger: process.env.NODE_ENV === "development" ? console.log : undefined,
    });
  }
  return workerInstance;
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
  const psm = config.tesseractPsm ?? DEFAULT_ROSTER_OCR_CONFIG.tesseractPsm ?? 6;
  const minConf =
    config.minWordConfidence ??
    DEFAULT_ROSTER_OCR_CONFIG.minWordConfidence ??
    40;

  const worker = await getWorker();

  await worker.setParameters({
    tessedit_pageseg_mode: String(psm) as Parameters<typeof worker.setParameters>[0]["tessedit_pageseg_mode"],
    ...(config.charWhitelist
      ? { tessedit_char_whitelist: config.charWhitelist }
      : {}),
  });

  const { data } = await worker.recognize(imageBuffer);

  // Flatten all lines from all paragraphs
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
}

/** Terminate the worker. Call during graceful shutdown if needed. */
export async function terminateTesseractWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
  }
}
