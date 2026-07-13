import "server-only";

import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import {
  parseDepositSlipHistoryText,
  type ParsedDepositSlipHistory,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

export type ParseDepositSlipImageResult = ParsedDepositSlipHistory & {
  rawLines: string[];
  durationMs: number;
};

/**
 * Still-frame Deposit Slip History OCR: reuse roster preprocess + Tesseract,
 * then domain-parse the text lines (preserving per-line confidence for dedupe
 * pick-best).
 */
export async function parseDepositSlipImage(
  imageBuffer: Buffer,
): Promise<ParseDepositSlipImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } = await preprocessRosterImage(
    imageBuffer,
    DEFAULT_ROSTER_OCR_CONFIG,
  );
  const ocrLines = await runTesseract(
    processedBuffer,
    DEFAULT_ROSTER_OCR_CONFIG,
  );
  const rawLines = ocrLines.map((line) => line.text);
  const parsed = parseDepositSlipHistoryText(
    ocrLines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
    })),
  );
  return {
    ...parsed,
    rawLines,
    durationMs: Date.now() - t0,
  };
}
