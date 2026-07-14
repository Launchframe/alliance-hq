import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePowerDetailsImage } from "@/lib/thp/hero-power-ocr/parse-power-details-image";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";

const FIXTURE =
  "/Users/andrew/.cursor/projects/var-folders-3l-jn9s48b14030mc006rfnyzgh0000gn-T-252d3d3a-376c-4182-be98-d477289d437b/assets/Screenshot_20260714_013040_Last_War-6fcd2a1d-6f48-44de-88e9-5fb21198445e.png";

describe("power details image fixture Jul 14", () => {
  it("OCRs Hero Power total from the attached screenshot", async () => {
    if (!fs.existsSync(FIXTURE)) return;
    await terminateTesseractWorker();
    const buf = fs.readFileSync(FIXTURE);
    const result = await parsePowerDetailsImage(buf);
    // eslint-disable-next-line no-console
    console.log("image ocr", {
      total: result.heroPowerTotal,
      complete: result.complete,
      breakdown: result.breakdown,
      lines: result.diagnostics.sampleLines,
    });
    expect(result.heroPowerTotal).toBe(163_381_480);
    expect(result.breakdown.decorationsAndBuildings).toBe(37_293_172);
    expect(result.breakdown.exclusiveWeapons).toBe(9_085_358);
  }, 180_000);
});
