import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { parsePowerDetailsImage } from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";
import { sumThpBreakdown } from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(
    path.join(fixtureDir, "fixtures/power-details-manifest.json"),
    "utf8",
  ),
) as Array<{
  id: string;
  file: string;
  heroPowerTotal: number;
  breakdown: ThpBreakdown;
}>;

/**
 * Live geometry-first OCR against real phone/PC screenshots.
 *
 *   THP_OCR_LIVE=1 npx vitest run src/lib/thp/hero-power-ocr/parse-power-details-image.live.test.ts
 *   THP_OCR_LIVE=1 THP_OCR_LIVE_STRICT=1 npx vitest run …
 */
describe("parsePowerDetailsImage live fixture matrix", () => {
  afterAll(async () => {
    await terminateTesseractWorker();
  });

  it.skipIf(process.env.THP_OCR_LIVE !== "1")(
    "never accepts 12-digit comma→digit header junk",
    async () => {
      const buffer = readFileSync(
        path.join(fixtureDir, "fixtures/power-details-2026-07-20.png"),
      );
      const parsed = await parsePowerDetailsImage(buffer);
      if (parsed.heroPowerTotal != null) {
        expect(String(parsed.heroPowerTotal).length).toBeLessThanOrEqual(9);
      }
      expect(
        parsed.diagnostics.sampleLines.some((line) =>
          /164376153505|8578681520/.test(line),
        ),
      ).toBe(false);
    },
    120_000,
  );

  it.each(manifest)(
    "parses $id ($file)",
    async (fixture) => {
      if (process.env.THP_OCR_LIVE !== "1") return;

      const buffer = readFileSync(path.join(fixtureDir, "fixtures", fixture.file));
      const parsed = await parsePowerDetailsImage(buffer);

      expect(parsed.diagnostics.modalRect).toBeDefined();
      expect(parsed.diagnostics.quality).toBeDefined();
      expect(parsed.diagnostics.pairedCount ?? 0).toBeGreaterThanOrEqual(5);
      expect(parsed.diagnostics.bboxOverlays?.length ?? 0).toBeGreaterThan(0);

      if (process.env.THP_OCR_LIVE_STRICT === "1") {
        expect(parsed.heroPowerTotal).toBe(fixture.heroPowerTotal);
        expect(parsed.diagnostics.pairedCount ?? 0).toBeGreaterThanOrEqual(6);
        for (const [key, value] of Object.entries(fixture.breakdown)) {
          expect(parsed.breakdown[key as keyof ThpBreakdown]).toBe(value);
        }
        expect(sumThpBreakdown(parsed.breakdown as ThpBreakdown)).toBe(
          fixture.heroPowerTotal,
        );
      }
    },
    120_000,
  );
});
