/**
 * Golden fixture test for parse-roster-image.
 *
 * Runs the full OCR pipeline against the real fixture PNGs (tesseract.js +
 * sharp). Opt in locally with RUN_TESSERACT_FIXTURES=true — skipped by default
 * in CI to avoid WASM init cost and missing traineddata paths.
 *
 * The mocked-OCR section below still exercises segment/parse logic in CI.
 */

import path from "node:path";
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { parseRosterImage } from "@/lib/members/roster-ocr/parse-roster-image";
import { parseRosterRows } from "@/lib/members/roster-ocr/parse-rows";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";

const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
const RUN_TESSERACT = process.env.RUN_TESSERACT_FIXTURES === "true";

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

afterAll(async () => {
  await terminateTesseractWorker();
});

// ---------------------------------------------------------------------------
// Mocked-OCR tests (always run — no Tesseract WASM needed)
// ---------------------------------------------------------------------------

describe("parseRosterRows — mocked OCR lines (officers layout)", () => {
  // Simulates what Tesseract would produce for the officers screenshot
  const mockedLines = [
    "Leader BigDaddy 8.5M Lv.95",
    "Warlord TigerShark 4.2M Lv.80",
    "Recruiter StarDust Lv.75",
    "Muse CoolGirl 3.1M",
    "Butler ServantHero 2.8M Lv.65",
    "Online",
    "Search for Members",
    "Manage",
  ];

  it("parses all five titled officers", () => {
    const { rows, layout } = parseRosterRows(mockedLines);
    expect(layout).toBe("officers");
    expect(rows.length).toBe(5);
  });

  it("correctly identifies Leader as R5", () => {
    const { rows } = parseRosterRows(mockedLines);
    const leader = rows.find((r) => r.allianceRankTitle === "Leader");
    expect(leader).toBeDefined();
    expect(leader?.allianceRank).toBe(5);
    expect(leader?.extractedName).toContain("BigDaddy");
    expect(leader?.heroPowerM).toBeCloseTo(8.5);
    expect(leader?.memberLevel).toBe(95);
  });

  it("correctly identifies R4 titled officers", () => {
    const { rows } = parseRosterRows(mockedLines);
    const warlord = rows.find((r) => r.allianceRankTitle === "Warlord");
    expect(warlord?.allianceRank).toBe(4);
    expect(warlord?.heroPowerM).toBeCloseTo(4.2);

    const recruiter = rows.find((r) => r.allianceRankTitle === "Recruiter");
    expect(recruiter?.memberLevel).toBe(75);
  });

  it("excludes all ignored lines", () => {
    const { rows } = parseRosterRows(mockedLines);
    const names = rows.map((r) => r.extractedName.toLowerCase());
    expect(names.some((n) => n.includes("online"))).toBe(false);
    expect(names.some((n) => n.includes("manage"))).toBe(false);
    expect(names.some((n) => n.includes("search"))).toBe(false);
  });
});

describe("parseRosterRows — mocked OCR lines (rank_list layout)", () => {
  // Simulates what Tesseract would produce for the R3 rank-list screenshot
  const mockedLines = [
    "Search for Members",
    "R5",
    "BigLeader 9.1M Lv.99",
    "R4",
    "Officer1 4.5M Lv.82",
    "Officer2 3.8M",
    "R3",
    "Member1 2.1M Lv.70",
    "Member2 1.9M",
    "Member3 Lv.68",
    "Online",
    "5m ago",
    "R2",
    "Junior1 0.8M",
    "R1",
    "Newbie1",
  ];

  it("detects rank_list layout", () => {
    const { layout } = parseRosterRows(mockedLines);
    expect(layout).toBe("rank_list");
  });

  it("assigns correct ranks", () => {
    const { rows } = parseRosterRows(mockedLines);
    const leader = rows.find((r) => r.extractedName.includes("BigLeader"));
    expect(leader?.allianceRank).toBe(5);

    const member2 = rows.find((r) => r.extractedName.includes("Member2"));
    expect(member2?.allianceRank).toBe(3);

    const junior = rows.find((r) => r.extractedName.includes("Junior1"));
    expect(junior?.allianceRank).toBe(2);

    const newbie = rows.find((r) => r.extractedName.includes("Newbie1"));
    expect(newbie?.allianceRank).toBe(1);
  });

  it("excludes ignored/chrome lines", () => {
    const { rows } = parseRosterRows(mockedLines);
    const names = rows.map((r) => r.extractedName);
    expect(names.some((n) => n.toLowerCase().includes("online"))).toBe(false);
    expect(names.some((n) => n.toLowerCase().includes("ago"))).toBe(false);
    expect(names.some((n) => n.toLowerCase().includes("search"))).toBe(false);
  });

  it("extracts power and level stats when present", () => {
    const { rows } = parseRosterRows(mockedLines);
    const officer1 = rows.find((r) => r.extractedName.includes("Officer1"));
    expect(officer1?.heroPowerM).toBeCloseTo(4.5);
    expect(officer1?.memberLevel).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Real Tesseract golden tests (skipped by default in CI)
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_TESSERACT)("parseRosterImage — fixture: officers layout", () => {
  it("extracts rows from bigd-titled-officers-r5-and-r4.png", async () => {
    const buf = loadFixture("bigd-titled-officers-r5-and-r4.png");
    const result = await parseRosterImage(buf);

    expect(result.layout).toBe("officers");
    expect(result.rows.length).toBeGreaterThan(0);

    // Expect at least one R5 Leader row
    const leaders = result.rows.filter((r) => r.allianceRank === 5);
    expect(leaders.length).toBeGreaterThanOrEqual(1);

    // Expect at least one R4 titled row
    const r4Titled = result.rows.filter(
      (r) => r.allianceRank === 4 && r.allianceRankTitle,
    );
    expect(r4Titled.length).toBeGreaterThanOrEqual(1);

    // All rows should have a non-empty extracted name
    for (const row of result.rows) {
      expect(row.extractedName.trim().length).toBeGreaterThan(0);
    }
  }, 30_000);
});

describe.skipIf(!RUN_TESSERACT)("parseRosterImage — fixture: rank_list layout", () => {
  it("extracts rows from bigd-r3-1.png", async () => {
    const buf = loadFixture("bigd-r3-1.png");
    const result = await parseRosterImage(buf);

    expect(result.rows.length).toBeGreaterThan(0);

    // Should have detected some rank context
    const rankedRows = result.rows.filter((r) => r.allianceRank >= 1);
    expect(rankedRows.length).toBeGreaterThan(0);

    // Should include power values for at least some rows
    const withPower = result.rows.filter((r) => r.heroPowerM !== undefined);
    expect(withPower.length).toBeGreaterThan(0);

    // No name should be empty
    for (const row of result.rows) {
      expect(row.extractedName.trim().length).toBeGreaterThan(0);
    }
  }, 30_000);
});
