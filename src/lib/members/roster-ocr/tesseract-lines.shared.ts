/**
 * Extract confidence-filtered OCR lines from a tesseract.js recognize() result.
 *
 * tesseract.js v7+ returns only `text` unless `output.blocks` is requested —
 * callers must pass `{ blocks: true }` (and typically `text: true`) to
 * `worker.recognize`. When blocks are missing, fall back to splitting `text`.
 */

export type TesseractLineLike = {
  text?: string | null;
  confidence?: number | null;
};

export type TesseractBlockLike = {
  paragraphs?: Array<{
    lines?: TesseractLineLike[] | null;
  }> | null;
};

export type TesseractRecognizeDataLike = {
  blocks?: TesseractBlockLike[] | null;
  text?: string | null;
};

export type ExtractedOcrLine = {
  text: string;
  confidence: number;
};

export function extractOcrLinesFromTesseractData(
  data: TesseractRecognizeDataLike,
  minConfidence: number,
): ExtractedOcrLine[] {
  const lines: ExtractedOcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = (line.text ?? "").replace(/\n/g, " ").trim();
        if (!text) continue;
        const confidence = line.confidence ?? 0;
        if (confidence < minConfidence) continue;
        lines.push({ text, confidence });
      }
    }
  }

  if (lines.length > 0) return lines;

  // Fallback when blocks were not requested / null but plain text exists.
  const fallback = (data.text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, confidence: 100 }));

  return fallback;
}
