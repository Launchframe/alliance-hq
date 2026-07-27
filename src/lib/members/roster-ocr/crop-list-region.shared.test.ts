import { describe, expect, it } from "vitest";

import {
  cropRosterLinesBelowSearch,
  cropTextLinesBelowSearch,
} from "@/lib/members/roster-ocr/crop-list-region.shared";

describe("cropTextLinesBelowSearch", () => {
  it("drops header lines above Search for Members", () => {
    const result = cropTextLinesBelowSearch([
      "R5| Corn Goo Smeller",
      "Warlord",
      "Recruiter",
      "Muse",
      "Butler",
      "Search for Members",
      "R3",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    expect(result.croppedBelowSearch).toBe(true);
    expect(result.lines.map((l) => l.text)).toEqual([
      "R3",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
  });

  it("keeps all lines when Search is absent", () => {
    const result = cropTextLinesBelowSearch(["R3", "Player1"]);
    expect(result.croppedBelowSearch).toBe(false);
    expect(result.lines).toHaveLength(2);
  });
});

describe("cropRosterLinesBelowSearch (bbox)", () => {
  it("keeps only lines below the Search bar y1", () => {
    const result = cropRosterLinesBelowSearch([
      { text: "R5 Corn", bbox: { y0: 10, y1: 40 } },
      { text: "Warlord", bbox: { y0: 50, y1: 70 } },
      { text: "Search for Members", bbox: { y0: 200, y1: 230 } },
      { text: "R3", bbox: { y0: 240, y1: 260 } },
      { text: "C Price", bbox: { y0: 270, y1: 300 } },
      { text: "header leak", bbox: { y0: 80, y1: 100 } },
    ]);
    expect(result.croppedBelowSearch).toBe(true);
    expect(result.lines.map((l) => l.text)).toEqual(["R3", "C Price"]);
  });
});
