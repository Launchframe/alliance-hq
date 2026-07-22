import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { parsePowerDetailsImage } from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";
import { sumThpBreakdown } from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const JUL20_FIXTURE = path.join(fixtureDir, "fixtures/power-details-2026-07-20.png");

/**
 * Live geometry-first OCR against a real phone screenshot.
 *
 * Asserts the architectural contract (digits-only path never accepts 12-digit
 * comma→digit headers; y-zip pairs labeled rows). Full pixel-perfect totals
 * still depend on Tesseract glyph quality — enable strict checks with
 * `THP_OCR_LIVE_STRICT=1`.
 *
 *   THP_OCR_LIVE=1 npx vitest run src/lib/thp/hero-power-ocr/parse-power-details-image.live.test.ts
 *   THP_OCR_LIVE=1 THP_OCR_LIVE_STRICT=1 npx vitest run …
 */
describe("parsePowerDetailsImage live fixture", () => {
  afterAll(async () => {
    await terminateTesseractWorker();
  });

  it.skipIf(process.env.THP_OCR_LIVE !== "1")(
    "reads Jul 20 Power Details via geometry columns (no 12-digit header junk)",
    async () => {
      const buffer = readFileSync(JUL20_FIXTURE);
      const parsed = await parsePowerDetailsImage(buffer);

      // Architectural guard: freeform comma→digit totals were 11–12 digits.
      if (parsed.heroPowerTotal != null) {
        expect(String(parsed.heroPowerTotal).length).toBeLessThanOrEqual(9);
        expect(parsed.heroPowerTotal).toBeGreaterThanOrEqual(1_000_000);
        expect(parsed.heroPowerTotal).toBeLessThanOrEqual(1_000_000_000);
      }
      expect(parsed.diagnostics.pairedCount ?? 0).toBeGreaterThanOrEqual(5);
      expect(
        parsed.diagnostics.sampleLines.some((line) =>
          /164376153505|8578681520/.test(line),
        ),
      ).toBe(false);

      if (process.env.THP_OCR_LIVE_STRICT === "1") {
        expect(parsed.heroPowerTotal).toBe(164_615_505);
        expect(parsed.complete).toBe(true);
        expect(parsed.breakdown.heroLevel).toBe(85_868_520);
        expect(parsed.breakdown.decorationsAndBuildings).toBe(37_811_658);
        expect(parsed.breakdown.gear).toBe(13_190_850);
        expect(parsed.breakdown.exclusiveWeapons).toBe(9_408_080);
        expect(parsed.breakdown.heroTier).toBe(7_051_707);
        expect(parsed.breakdown.heroSkill).toBe(6_581_990);
        expect(parsed.breakdown.wallOfHonor).toBe(4_702_700);
        expect(sumThpBreakdown(parsed.breakdown as ThpBreakdown)).toBe(
          164_615_505,
        );
      }
    },
    120_000,
  );
});
