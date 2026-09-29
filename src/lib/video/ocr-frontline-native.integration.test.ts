import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";
import { parseFrontlineImage } from "./ocr-frontline-native";
import { collapseFrontlineEntries } from "./frontline-breakthrough.shared";

const fixtures = [
  {
    path: new URL("./__ocr_fixtures__/frontline-breakthrough/alliance-top.png", import.meta.url),
    scores: [[1, 2704], [2, 2685], [3, 2670], [4, 2591], [5, 2532], [6, 2508], [7, 2501], [8, 2376], [9, 2365], [10, 2294], [11, 2131], [14, 1824]],
  },
  {
    path: new URL("./__ocr_fixtures__/frontline-breakthrough/alliance-scrolled.png", import.meta.url),
    scores: [[1, 2704], [2, 2685], [3, 2670], [14, 1824], [18, 1692], [19, 1663], [20, 1563], [21, 1539], [22, 1528], [23, 1518], [24, 1517], [25, 1504]],
  },
];

describe.skipIf(process.env.FRONTLINE_NATIVE_OCR_TEST !== "1")("Frontline real screenshot recognition", () => {
  afterAll(async () => { await terminateTesseractWorker(); });
  it("reads both supplied screenshots without inventing or dropping complete ranks", async () => {
    const batches = [];
    for (const fixture of fixtures) {
      const image = await readFile(fixture.path);
      const result = await parseFrontlineImage(image);
      expect(result.selectedTab).toBe("alliance");
      expect(result.entries.map((entry) => [entry.rank, Number(entry.score)]).sort((a, b) => a[0]! - b[0]!)).toEqual(fixture.scores);
      expect(result.entries.every((entry) => entry.frontlineStage === 5)).toBe(true);
      expect(result.entries.find((entry) => entry.rank === 14)?.name).toBe("BOGGLE");
      batches.push(...result.entries);
    }
    expect(collapseFrontlineEntries(batches).entries).toHaveLength(20);
  }, 120000);
  it("keeps the same numeric results at a different input resolution", async () => {
    const image = await sharp(await readFile(fixtures[0].path)).resize({ width: 840 }).png().toBuffer();
    const result = await parseFrontlineImage(image);
    expect(result.entries.map((entry) => [entry.rank, Number(entry.score)]).sort((a, b) => a[0]! - b[0]!)).toEqual(fixtures[0].scores);
  }, 120000);
});
