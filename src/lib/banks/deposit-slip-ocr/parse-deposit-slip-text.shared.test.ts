import { describe, expect, it } from "vitest";

import {
  mergeDepositSlipHistoryParses,
  parseDepositSlipHistoryText,
  parseDepositSlipIdentity,
  parseDepositSlipTimestamp,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

/** Golden lines transcribed from all-slips-warzone.png fixture. */
const ALL_SLIPS_WARZONE_LINES = [
  "Deposit Slip History",
  "This bank is open to Commanders within the same Warzone as the owner.",
  "Minimum Deposit for This Bank: 6000",
  "All Deposit Slips",
  "2026-7-10 12:14:34",
  "#1211[GRoW]3MinOfDisappointment",
  "Deposit: CrystalGold x 6000, Term: 3 day(s).",
  "2026-7-10 12:01:39",
  "#1211[Roar]Capt Grim",
  "Deposit: CrystalGold x 6000, Term: 1 days.",
  "Total return: CrystalGold x 7440.",
  "2026-7-10 11:45:11",
  "#1211[XNES]Jhonsoncat",
  "Deposit: CrystalGold x 6000, Term: 1 days.",
  "Total return: CrystalGold x 6660.",
  "2026-7-10 10:39:43",
  "#1211[bOND]Derp D Dolphin",
  "Deposit: CrystalGold x 6000, Term: 3 day(s).",
];

/** Golden lines from my-slips-warzone-mixed.png */
const MY_SLIPS_MIXED_LINES = [
  "Deposit Slip History",
  "This bank is open to Commanders within the same Warzone as the owner.",
  "Minimum Deposit for This Bank: 6000",
  "My Deposit Slip",
  "2026-7-8 21:08:46",
  "#1211[Roar]snapz a saurus",
  "Deposit: CrystalGold x 6000, Term: 1 days.",
  "Total return: CrystalGold x 7440.",
  "2026-7-7 21:08:46",
  "#1211[Roar]snapz a saurus",
  "Deposit: CrystalGold x 6000, Term: 1 day(s).",
];

/** Golden lines from my-slips-alliance-early-term.png */
const MY_SLIPS_EARLY_TERM_LINES = [
  "Deposit Slip History",
  "This bank is open only to the owning Alliance.",
  "Minimum Deposit for This Bank: 100",
  "My Deposit Slip",
  "2026-7-9 12:49:35",
  "#1211[Roar]snapz a saurus",
  "Deposit: CrystalGold x 6000, Term: 3 days.",
  "Early termination refund: CrystalGold x 5970.",
  "2026-7-7 09:46:02",
  "#1211[Roar]snapz a saurus",
  "Deposit: CrystalGold x 6000, Term: 3 day(s).",
];

describe("parseDepositSlipTimestamp", () => {
  it("parses single-digit month/day as UTC ISO", () => {
    expect(parseDepositSlipTimestamp("2026-7-10 12:14:34")).toBe(
      "2026-07-10T12:14:34.000Z",
    );
  });
});

describe("parseDepositSlipIdentity", () => {
  it("splits server, tag, and commander name", () => {
    expect(parseDepositSlipIdentity("#1211[GRoW]3MinOfDisappointment")).toEqual({
      gameServerNumber: 1211,
      allianceTag: "GRoW",
      commanderName: "3MinOfDisappointment",
      rawIdentity: "#1211[GRoW]3MinOfDisappointment",
    });
  });

  it("allows spaces in commander names", () => {
    expect(parseDepositSlipIdentity("#1211[Roar]snapz a saurus")?.commanderName).toBe(
      "snapz a saurus",
    );
  });
});

describe("parseDepositSlipHistoryText", () => {
  it("parses all-slips warzone fixture text", () => {
    const parsed = parseDepositSlipHistoryText(ALL_SLIPS_WARZONE_LINES);
    expect(parsed.depositPolicy).toBe("warzone");
    expect(parsed.minimumDeposit).toBe(6000);
    expect(parsed.slips).toHaveLength(4);

    expect(parsed.slips[0]).toMatchObject({
      depositAt: "2026-07-10T12:14:34.000Z",
      amount: 6000,
      termDays: 3,
      status: "locked",
      outcomeKind: null,
      identity: {
        allianceTag: "GRoW",
        commanderName: "3MinOfDisappointment",
      },
    });

    expect(parsed.slips[1]).toMatchObject({
      amount: 6000,
      termDays: 1,
      status: "matured",
      outcomeKind: "total_return",
      outcomeAmount: 7440,
      identity: { allianceTag: "Roar", commanderName: "Capt Grim" },
    });

    expect(parsed.slips[2]).toMatchObject({
      status: "matured",
      outcomeAmount: 6660,
      identity: { allianceTag: "XNES", commanderName: "Jhonsoncat" },
    });
  });

  it("parses my-slips mixed locked + matured", () => {
    const parsed = parseDepositSlipHistoryText(MY_SLIPS_MIXED_LINES);
    expect(parsed.slips).toHaveLength(2);
    expect(parsed.slips[0]?.status).toBe("matured");
    expect(parsed.slips[1]?.status).toBe("locked");
    expect(parsed.slips[1]?.termDays).toBe(1);
  });

  it("parses alliance policy and early termination as looted", () => {
    const parsed = parseDepositSlipHistoryText(MY_SLIPS_EARLY_TERM_LINES);
    expect(parsed.depositPolicy).toBe("alliance");
    expect(parsed.minimumDeposit).toBe(100);
    expect(parsed.slips).toHaveLength(2);
    expect(parsed.slips[0]).toMatchObject({
      status: "looted",
      outcomeKind: "early_termination_refund",
      outcomeAmount: 5970,
      termDays: 3,
    });
    expect(parsed.slips[1]?.status).toBe("locked");
  });

  it("dedupes overlapping frame parses into a lifecycle-merged deposit", () => {
    const a = parseDepositSlipHistoryText(MY_SLIPS_MIXED_LINES);
    const b = parseDepositSlipHistoryText(MY_SLIPS_MIXED_LINES.slice(4));
    const merged = mergeDepositSlipHistoryParses([a, b]);
    // Locked (Jul 7) + matured (Jul 8) for the same commander collapse to one row.
    expect(merged.history.slips).toHaveLength(1);
    expect(merged.history.slips[0]).toMatchObject({
      status: "matured",
      depositAt: "2026-07-07T21:08:46.000Z",
      outcomeAt: "2026-07-08T21:08:46.000Z",
      amount: 6000,
    });
  });

  it("attaches mean Tesseract confidence from contributing OCR lines", () => {
    const parsed = parseDepositSlipHistoryText([
      { text: "Deposit Slip History", confidence: 99 },
      { text: "2026-7-10 12:14:34", confidence: 80 },
      { text: "#1211[Roar]Capt Grim", confidence: 90 },
      {
        text: "Deposit: CrystalGold x 6000, Term: 1 days.",
        confidence: 70,
      },
    ]);

    expect(parsed.slips).toHaveLength(1);
    expect(parsed.slips[0]?.confidence).toBeCloseTo((80 + 90 + 70) / 3);
  });

  it("still finds the timestamp when garbled OCR inserts a few junk lines before the identity", () => {
    const lines = [
      "2026-7-10 12:14:34",
      "UBPOSIT: LIYStalLoin", // hallucinated junk line
      "|| ||", // another junk line
      "#1211[GRoW]3MinOfDisappointment",
      "Deposit: CrystalGold x 6000, Term: 3 day(s).",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(1);
    expect(parsed.slips[0]?.depositAt).toBe("2026-07-10T12:14:34.000Z");
  });

  it("never borrows the previous row's timestamp when this row's own timestamp was dropped entirely", () => {
    const lines = [
      "2026-7-10 12:14:34",
      "#1211[GRoW]3MinOfDisappointment",
      "Deposit: CrystalGold x 6000, Term: 3 day(s).",
      // This row's own timestamp line never made it through OCR.
      "#1211[Roar]Capt Grim",
      "Deposit: CrystalGold x 6000, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(2);
    expect(parsed.slips[0]?.identity.commanderName).toBe("3MinOfDisappointment");
    expect(parsed.slips[0]?.depositAt).toBe("2026-07-10T12:14:34.000Z");
    expect(parsed.slips[1]?.identity.commanderName).toBe("Capt Grim");
    expect(parsed.slips[1]?.depositAt).toBeNull();
  });

  it("never borrows the next row's timestamp via forward search past a Deposit line", () => {
    // Own timestamp dropped; only one content line before the next row's
    // timestamp — forward search must not walk past Deposit into that ts.
    const lines = [
      "#1211[GRoW]3MinOfDisappointment",
      "Deposit: CrystalGold x 6000, Term: 3 day(s).",
      "2026-7-10 12:01:39",
      "#1211[Roar]Capt Grim",
      "Deposit: CrystalGold x 6000, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(2);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName["3MinOfDisappointment"]?.depositAt).toBeNull();
    expect(byName["Capt Grim"]?.depositAt).toBe("2026-07-10T12:01:39.000Z");
  });

  it("still finds a timestamp that OCR placed immediately after the identity", () => {
    const lines = [
      "#1211[Roar]Capt Grim",
      "2026-7-10 12:01:39",
      "Deposit: CrystalGold x 6000, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(1);
    expect(parsed.slips[0]?.depositAt).toBe("2026-07-10T12:01:39.000Z");
  });

  it("does not steal the previous row's timestamp when that row's identity was garbled", () => {
    // Previous identity failed IDENTITY_RE; Deposit still marks the row
    // boundary so Capt Grim must not inherit the orphaned timestamp.
    const lines = [
      "2026-7-10 12:14:34",
      "1211 GRoW 3MinOfDisappointment",
      "Deposit: CrystalGold x 6000, Term: 3 day(s).",
      "#1211[Roar]Capt Grim",
      "Deposit: CrystalGold x 6000, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(1);
    expect(parsed.slips[0]?.identity.commanderName).toBe("Capt Grim");
    expect(parsed.slips[0]?.depositAt).toBeNull();
  });

  it("stops reading-order look-ahead at the next claimed identity line", () => {
    // Identities are always pre-claimed. Claimed-skip before the identity
    // boundary would let Upper walk into Lower's Deposit.
    const lines = [
      "#1203[LFgo]Upper",
      "#1203[LFgo]Lower",
      "Deposit: CrystalGold x 1111, Term: 1 days.",
      "Deposit: CrystalGold x 2222, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper).toBeUndefined();
    expect(byName.Lower?.amount).toBe(1111);
  });

  it("does not assign the next row's timestamp across a claimed identity boundary", () => {
    const lines = [
      "#1203[LFgo]Upper",
      "#1203[LFgo]Lower",
      "2026-7-10 12:00:00",
      "Deposit: CrystalGold x 2222, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper).toBeUndefined();
    expect(byName.Lower?.depositAt).toBe("2026-07-10T12:00:00.000Z");
    expect(byName.Lower?.amount).toBe(2222);
  });
});

describe("parseDepositSlipHistoryText — vertical line-bbox association", () => {
  /** Helper: build a line with a synthetic vertical band. */
  function geoLine(
    text: string,
    y0: number,
    height = 28,
  ): {
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  } {
    return {
      text,
      confidence: 90,
      bbox: { x0: 40, y0, x1: 400, y1: y0 + height },
    };
  }

  it("keeps amounts on the geometrically nearer commander when OCR reading order interleaves rows", () => {
    // Reading order would give Yodehh Cheesy's 5166 (next Deposit within the
    // look-ahead window before Cheesy's identity). Vertical centers put each
    // Deposit under the correct identity.
    const lines = [
      geoLine("2026-7-11 10:00:00", 40),
      geoLine("#1203[LFgo]Yodehh", 80),
      geoLine("2026-7-11 10:01:00", 200),
      geoLine("#1203[LFgo]CheesyD03", 240),
      geoLine("Deposit: CrystalGold x 5166, Term: 1 days.", 280),
      geoLine("Deposit: CrystalGold x 4000, Term: 1 days.", 120),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(2);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Yodehh?.amount).toBe(4000);
    expect(byName.CheesyD03?.amount).toBe(5166);
    expect(byName.Yodehh?.depositAt).toBe("2026-07-11T10:00:00.000Z");
    expect(byName.CheesyD03?.depositAt).toBe("2026-07-11T10:01:00.000Z");
  });

  it("still uses reading-order association when line bboxes are absent", () => {
    const lines = [
      "2026-7-11 10:00:00",
      "#1203[LFgo]Yodehh",
      "Deposit: CrystalGold x 5166, Term: 1 days.",
      "#1203[LFgo]CheesyD03",
      "Deposit: CrystalGold x 4000, Term: 1 days.",
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    // Without geometry, Yodehh still consumes the next Deposit in order.
    expect(byName.Yodehh?.amount).toBe(5166);
    expect(byName.CheesyD03?.amount).toBe(4000);
  });

  it("attaches total-return outcomes to the identity above them by y", () => {
    const lines = [
      geoLine("2026-7-11 09:00:00", 40),
      geoLine("#1203[LFgo]Alpha", 80),
      geoLine("Deposit: CrystalGold x 6000, Term: 1 days.", 120),
      geoLine("Total return: CrystalGold x 6840.", 150),
      geoLine("2026-7-11 09:05:00", 220),
      geoLine("#1203[LFgo]Beta", 260),
      geoLine("Deposit: CrystalGold x 5000, Term: 1 days.", 300),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Alpha?.status).toBe("matured");
    expect(byName.Alpha?.outcomeAmount).toBe(6840);
    expect(byName.Beta?.status).toBe("locked");
    expect(byName.Beta?.outcomeAmount).toBeNull();
  });

  it("assigns a Deposit past the midpoint to the lower identity (y-band, not nearest-above)", () => {
    // A=80, B=200 → midpoint 140. Deposit at 160 is closer to B but still
    // above B — nearest-above would steal it for A; y-banding gives it to B.
    const lines = [
      geoLine("2026-7-11 10:00:00", 40),
      geoLine("#1203[LFgo]Upper", 80),
      geoLine("Deposit: CrystalGold x 1111, Term: 1 days.", 110),
      geoLine("2026-7-11 10:01:00", 170),
      geoLine("#1203[LFgo]Lower", 200),
      geoLine("Deposit: CrystalGold x 2222, Term: 1 days.", 160),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1111);
    expect(byName.Lower?.amount).toBe(2222);
  });

  it("falls back to reading-order when any identity lacks a line bbox", () => {
    // Only Lower has geometry. If geometry ran with a half-threshold gate,
    // the Deposit at y=120 (Upper's) could attach to Lower. Full fallback
    // keeps reading-order: Upper consumes 1111, Lower consumes 2222.
    const lines = [
      { text: "2026-7-11 10:00:00", confidence: 90 },
      { text: "#1203[LFgo]Upper", confidence: 90 },
      {
        text: "Deposit: CrystalGold x 1111, Term: 1 days.",
        confidence: 90,
        bbox: { x0: 40, y0: 120, x1: 400, y1: 148 },
      },
      {
        text: "2026-7-11 10:01:00",
        confidence: 90,
        bbox: { x0: 40, y0: 170, x1: 400, y1: 198 },
      },
      {
        text: "#1203[LFgo]Lower",
        confidence: 90,
        bbox: { x0: 40, y0: 200, x1: 400, y1: 228 },
      },
      {
        text: "Deposit: CrystalGold x 2222, Term: 1 days.",
        confidence: 90,
        bbox: { x0: 40, y0: 240, x1: 400, y1: 268 },
      },
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1111);
    expect(byName.Lower?.amount).toBe(2222);
  });

  it("does not let reading-order steal a second Deposit already banded to a full slot", () => {
    // Both Deposits land in Upper's y-band (midpoint with Lower at 200 is 140).
    // Closer 1111 fills Upper; 1333 is claimed as an orphan so Lower cannot
    // take it via interleaved reading-order look-ahead.
    const lines = [
      geoLine("2026-7-11 10:00:00", 40),
      geoLine("#1203[LFgo]Upper", 80),
      geoLine("2026-7-11 10:01:00", 170),
      geoLine("#1203[LFgo]Lower", 200),
      geoLine("Deposit: CrystalGold x 1333, Term: 1 days.", 125),
      geoLine("Deposit: CrystalGold x 1111, Term: 1 days.", 110),
      geoLine("Deposit: CrystalGold x 2222, Term: 1 days.", 240),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1111);
    expect(byName.Lower?.amount).toBe(2222);
  });

  it("uses the single-identity distance cap when only one commander is on frame", () => {
    // Only one anchor: identityForYBand's single-anchor branch (distance <=
    // maxGap) rather than the multi-anchor band loop. Deposit is close, so it
    // must still attach via geometry.
    const lines = [
      geoLine("2026-7-11 10:00:00", 40),
      geoLine("#1203[LFgo]Solo", 80),
      geoLine("Deposit: CrystalGold x 7777, Term: 3 days.", 120),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(1);
    expect(parsed.slips[0]?.amount).toBe(7777);
    expect(parsed.slips[0]?.depositAt).toBe("2026-07-11T10:00:00.000Z");
  });

  it("falls back to reading-order for a single field line missing its own bbox, without geometry mis-zipping the others", () => {
    // Both identities have full geometry (geometry runs), but Upper's Deposit
    // line individually lacks a bbox. It must still land on Upper via the
    // reading-order fallback, not on Lower.
    const lines = [
      geoLine("2026-7-11 10:00:00", 40),
      geoLine("#1203[LFgo]Upper", 80),
      { text: "Deposit: CrystalGold x 1111, Term: 1 days.", confidence: 90 },
      geoLine("2026-7-11 10:01:00", 170),
      geoLine("#1203[LFgo]Lower", 200),
      geoLine("Deposit: CrystalGold x 2222, Term: 1 days.", 240),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1111);
    expect(byName.Lower?.amount).toBe(2222);
  });

  it("routes each row to the correct commander across three interleaved identities (middle y-band)", () => {
    // Upper=80, Middle=200, Lower=320 → midpoints 140 and 260. Fields are
    // emitted out of row order to exercise the middle band specifically.
    const lines = [
      geoLine("#1203[LFgo]Upper", 80),
      geoLine("#1203[LFgo]Middle", 200),
      geoLine("#1203[LFgo]Lower", 320),
      geoLine("Deposit: CrystalGold x 3000, Term: 3 days.", 330),
      geoLine("Deposit: CrystalGold x 1000, Term: 1 days.", 90),
      geoLine("Deposit: CrystalGold x 2000, Term: 5 days.", 210),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1000);
    expect(byName.Middle?.amount).toBe(2000);
    expect(byName.Lower?.amount).toBe(3000);
  });

  it("does not attach a Deposit line beyond the max vertical gap to a lone identity", () => {
    // Single identity, but the only Deposit-shaped line is far outside the
    // gap cap (and outside the 5-line reading-order look-ahead too), so it
    // should end up unclaimed rather than geometrically forced onto Solo.
    const lines = [
      geoLine("#1203[LFgo]Solo", 80),
      geoLine("noise 1", 400),
      geoLine("noise 2", 440),
      geoLine("noise 3", 480),
      geoLine("noise 4", 520),
      geoLine("noise 5", 560),
      geoLine("Deposit: CrystalGold x 9999, Term: 1 days.", 900),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    expect(parsed.slips).toHaveLength(0);
  });

  it("falls back to reading-order when two identities share the same yCenter", () => {
    // Degenerate geometry: identical centers collapse a midpoint band to zero
    // width. Prefer full reading-order over shadowing one identity.
    const lines = [
      geoLine("#1203[LFgo]Upper", 100),
      geoLine("Deposit: CrystalGold x 1111, Term: 1 days.", 130),
      geoLine("#1203[LFgo]Lower", 100), // same yCenter as Upper → no geometry
      geoLine("Deposit: CrystalGold x 2222, Term: 1 days.", 160),
    ];
    const parsed = parseDepositSlipHistoryText(lines);
    const byName = Object.fromEntries(
      parsed.slips.map((s) => [s.identity.commanderName, s]),
    );
    expect(byName.Upper?.amount).toBe(1111);
    expect(byName.Lower?.amount).toBe(2222);
  });
});
