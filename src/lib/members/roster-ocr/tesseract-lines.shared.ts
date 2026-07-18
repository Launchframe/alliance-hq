/**
 * Extract confidence-filtered OCR lines from a tesseract.js recognize() result.
 *
 * tesseract.js v7+ returns only `text` unless `output.blocks` is requested —
 * callers must pass `{ blocks: true }` (and typically `text: true`) to
 * `worker.recognize`. When blocks are missing, fall back to splitting `text`.
 */

export type TesseractWordLike = {
  text?: string | null;
  bbox?: { x0?: number | null; x1?: number | null } | null;
};

export type TesseractLineLike = {
  text?: string | null;
  confidence?: number | null;
  words?: TesseractWordLike[] | null;
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

/**
 * Horizontal pixel span of a single OCR'd word within the source image,
 * paired with the word's own character range in the reconstructed
 * (single-space-joined) line text. Used to recover the on-image x-position
 * of a regex match spanning one or more words — see `xCenterForRange` in
 * the City List parser (`parse-city-list-text.shared.ts`).
 */
export type ExtractedOcrWordSpan = {
  text: string;
  /** Start offset (inclusive) of this word within the line's `text`. */
  charStart: number;
  /** End offset (exclusive) of this word within the line's `text`. */
  charEnd: number;
  x0: number;
  x1: number;
};

export type ExtractedOcrLine = {
  text: string;
  confidence: number;
  /** Word-level bbox spans, when the source line included `words`. */
  words?: ExtractedOcrWordSpan[];
};

/**
 * Rebuild line text as a single-space join of word texts (rather than
 * trusting tesseract's own spacing) so char offsets line up exactly with
 * `words[].charStart`/`charEnd` for downstream column-position lookups.
 * Falls back to the original `line.text` (returns null) when no words are
 * present, or when any non-blank word lacks a usable bbox — dropping just
 * that word would silently lose its text from the line, and partial word
 * data cannot be trusted for column matching anyway.
 */
function buildLineFromWords(
  line: TesseractLineLike,
): { text: string; words: ExtractedOcrWordSpan[] } | null {
  const rawWords = line.words;
  if (!rawWords || rawWords.length === 0) return null;

  const words: ExtractedOcrWordSpan[] = [];
  let cursor = 0;
  const parts: string[] = [];
  for (const word of rawWords) {
    const text = (word.text ?? "").trim();
    if (!text) continue;
    const x0 = word.bbox?.x0;
    const x1 = word.bbox?.x1;
    // Finite-number guard: NaN x-positions would otherwise flow into distance
    // sorting downstream and make column assignment nondeterministic.
    if (
      typeof x0 !== "number" ||
      typeof x1 !== "number" ||
      !Number.isFinite(x0) ||
      !Number.isFinite(x1)
    ) {
      return null;
    }
    if (parts.length > 0) cursor += 1; // joining space
    const charStart = cursor;
    const charEnd = charStart + text.length;
    words.push({ text, charStart, charEnd, x0, x1 });
    parts.push(text);
    cursor = charEnd;
  }
  if (words.length === 0) return null;
  return { text: parts.join(" "), words };
}

export function extractOcrLinesFromTesseractData(
  data: TesseractRecognizeDataLike,
  minConfidence: number,
): ExtractedOcrLine[] {
  const lines: ExtractedOcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const confidence = line.confidence ?? 0;
        if (confidence < minConfidence) continue;

        const fromWords = buildLineFromWords(line);
        const text = (
          fromWords?.text ??
          line.text ??
          ""
        )
          .replace(/\n/g, " ")
          .trim();
        if (!text) continue;

        lines.push(
          fromWords
            ? { text, confidence, words: fromWords.words }
            : { text, confidence },
        );
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
