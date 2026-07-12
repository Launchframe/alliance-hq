import { describe, expect, it } from "vitest";

import { parseKillsDetailsLines } from "@/lib/kills/kill-count-ocr/parse-kills-details";

describe("parseKillsDetailsLines", () => {
  it("reads an explicit total kills line", () => {
    const parsed = parseKillsDetailsLines([
      "Commander Stats",
      "Total Kills 152,340,112",
      "Troops 12,000",
    ]);
    expect(parsed.totalKills).toBe(152_340_112);
  });

  it("falls back to the largest plausible unlabeled total", () => {
    const parsed = parseKillsDetailsLines([
      "152340112",
      "Rank 4",
      "1200",
    ]);
    expect(parsed.totalKills).toBe(152_340_112);
  });

  it("returns null when nothing looks like a kill total", () => {
    expect(parseKillsDetailsLines(["hello", "world"]).totalKills).toBeNull();
  });
});
