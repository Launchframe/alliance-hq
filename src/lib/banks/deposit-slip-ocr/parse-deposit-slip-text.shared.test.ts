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

  it("dedupes overlapping frame parses", () => {
    const a = parseDepositSlipHistoryText(MY_SLIPS_MIXED_LINES);
    const b = parseDepositSlipHistoryText(MY_SLIPS_MIXED_LINES.slice(4));
    const merged = mergeDepositSlipHistoryParses([a, b]);
    expect(merged.history.slips).toHaveLength(2);
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
});
