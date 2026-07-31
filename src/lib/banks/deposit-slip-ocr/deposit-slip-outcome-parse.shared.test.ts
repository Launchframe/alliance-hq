import { describe, expect, it } from "vitest";

import {
  isDepositSlipOutcomeProbe,
  parseDepositSlipDepositLine,
  parseDepositSlipOutcomeLine,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-outcome-parse.shared";

describe("parseDepositSlipOutcomeLine", () => {
  it("parses strict total return", () => {
    expect(
      parseDepositSlipOutcomeLine("Total return: CrystalGold x 7440."),
    ).toEqual({ kind: "total_return", amount: 7440 });
  });

  it("parses garbled early termination refund", () => {
    expect(
      parseDepositSlipOutcomeLine(
        "Early terminatlon refund: CrystalGold x 5970",
      ),
    ).toEqual({ kind: "early_termination_refund", amount: 5970 });
  });

  it("parses abbreviated early refund without strict punctuation", () => {
    expect(
      parseDepositSlipOutcomeLine("early termination refund crystalgold x 1200"),
    ).toEqual({ kind: "early_termination_refund", amount: 1200 });
  });

  it("does not treat deposit line as outcome when refund tokens absent", () => {
    expect(
      parseDepositSlipOutcomeLine("Deposit: CrystalGold x 6000, Term: 3 day(s)."),
    ).toBeNull();
  });
});

describe("parseDepositSlipDepositLine", () => {
  it("parses deposit initiate lines", () => {
    expect(
      parseDepositSlipDepositLine("Deposit: CrystalGold x 6000, Term: 3 day(s)."),
    ).toEqual({ amount: 6000, termDays: 3 });
  });

  it("skips outcome lines that garble deposit prefix", () => {
    expect(
      parseDepositSlipDepositLine(
        "Deposit: CrystalGold x 6000, early termination refund",
      ),
    ).toBeNull();
    expect(isDepositSlipOutcomeProbe(
      "Deposit: CrystalGold x 6000, early termination refund",
    )).toBe(true);
  });

  it("parses garbled deposit keyword (Oepasit)", () => {
    expect(
      parseDepositSlipDepositLine(
        "| 2 Oepasit: CrystalGold x 6000, Term: 5 days.",
      ),
    ).toEqual({ amount: 6000, termDays: 5 });
  });

  it("parses term when amount token is garbled letters", () => {
    expect(
      parseDepositSlipDepositLine(
        "ty Oepasit: CrystalGald x BODO, Term: 5 day(s)",
      ),
    ).toEqual({ amount: null, termDays: 5 });
  });

  it("parses period separator between amount and term", () => {
    expect(
      parseDepositSlipDepositLine(
        "| Deposit: CrystalGold x 6000. Term: 5 day(s).",
      ),
    ).toEqual({ amount: 6000, termDays: 5 });
  });

  it("does not treat Termination as a deposit Term divider", () => {
    expect(
      parseDepositSlipDepositLine(
        "Deposit: CrystalGold x 6000, Termination pending",
      ),
    ).toBeNull();
  });
});
