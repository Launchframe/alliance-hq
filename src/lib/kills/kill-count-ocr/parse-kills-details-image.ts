import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import {
  parseKillsDetailsLines,
  type ParseKillsDetailsResult,
} from "@/lib/kills/kill-count-ocr/parse-kills-details";

export type ParseKillsDetailsImageResult = ParseKillsDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
    sampleLines: string[];
  };
};

export async function parseKillsDetailsImage(
  imageBuffer: Buffer,
): Promise<ParseKillsDetailsImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } = await preprocessRosterImage(imageBuffer);
  const ocrLines = await runTesseract(processedBuffer);
  const textLines = ocrLines.map((line) => line.text);
  const parsed = parseKillsDetailsLines(textLines);
  const durationMs = Date.now() - t0;
  const diagnostics = buildOcrDiagnostics({
    source: "kills_screenshot",
    durationMs,
    rawLineCount: textLines.length,
    lines: textLines,
    parsedOk: parsed.totalKills != null,
    parsedValue: parsed.totalKills,
  });
  logOcrDiagnostics(diagnostics);
  return {
    ...parsed,
    diagnostics: {
      rawLineCount: diagnostics.rawLineCount,
      durationMs: diagnostics.durationMs,
      sampleLines: diagnostics.sampleLines,
    },
  };
}
