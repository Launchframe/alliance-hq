import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
  sampleOcrLines,
} from "@/lib/ocr/ocr-diagnostics.shared";

describe("ocr diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("samples and truncates long lines", () => {
    const lines = [
      "a".repeat(200),
      "short",
      ...Array.from({ length: 20 }, (_, i) => `line-${i}`),
    ];
    const sample = sampleOcrLines(lines, 3);
    expect(sample).toHaveLength(3);
    expect(sample[0]?.endsWith("…")).toBe(true);
    expect(sample[1]).toBe("short");
  });

  it("logs a JSON payload under [ocr-diagnostics]", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const diagnostics = buildOcrDiagnostics({
      source: "thp_screenshot",
      durationMs: 42,
      rawLineCount: 2,
      lines: ["Hero Power 1,234", "Gear 5"],
      parsedOk: true,
      parsedValue: 1234,
    });
    logOcrDiagnostics(diagnostics);
    expect(spy).toHaveBeenCalledWith(
      "[ocr-diagnostics]",
      expect.stringContaining('"source":"thp_screenshot"'),
    );
  });
});
