/** Shared OCR diagnostics payload for screenshot + video parse logging. */

export type OcrDiagnosticsSource =
  | "thp_screenshot"
  | "kills_screenshot"
  | "video_frame_ashed"
  | "video_frame_native"
  | "video_roster_native"
  | "video_deposit_slip_native";

export type OcrDiagnostics = {
  source: OcrDiagnosticsSource;
  durationMs: number;
  rawLineCount: number;
  /** First few OCR lines (truncated) for failure investigation. */
  sampleLines: string[];
  parsedOk: boolean;
  parsedValue?: number | null;
  entryCount?: number;
  error?: string | null;
  jobId?: string;
  frameIndex?: number;
  scoreTarget?: string | null;
};

export const OCR_DIAGNOSTICS_SAMPLE_LINE_LIMIT = 12;
export const OCR_DIAGNOSTICS_SAMPLE_LINE_MAX_CHARS = 120;

export function sampleOcrLines(
  lines: string[],
  limit = OCR_DIAGNOSTICS_SAMPLE_LINE_LIMIT,
): string[] {
  return lines.slice(0, limit).map((line) =>
    line.length > OCR_DIAGNOSTICS_SAMPLE_LINE_MAX_CHARS
      ? `${line.slice(0, OCR_DIAGNOSTICS_SAMPLE_LINE_MAX_CHARS)}…`
      : line,
  );
}

export function buildOcrDiagnostics(
  input: Omit<OcrDiagnostics, "sampleLines"> & { lines?: string[] },
): OcrDiagnostics {
  const { lines, ...rest } = input;
  return {
    ...rest,
    sampleLines: sampleOcrLines(lines ?? []),
  };
}

/** Structured stdout log — searchable in Vercel as `[ocr-diagnostics]`. */
export function logOcrDiagnostics(diagnostics: OcrDiagnostics): void {
  console.log("[ocr-diagnostics]", JSON.stringify(diagnostics));
}
