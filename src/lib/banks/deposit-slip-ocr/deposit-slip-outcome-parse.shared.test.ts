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

  it("prefers the refund amount over a garbled deposit prefix on the same line", () => {
    expect(
      parseDepositSlipOutcomeLine(
        "Deposit: CrystalGold x 6000, early termination refund x 5970",
      ),
    ).toEqual({ kind: "early_termination_refund", amount: 5970 });
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
});
