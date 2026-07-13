import { describe, expect, it } from "vitest";

import {
  pairDepositSlipTerminalRows,
  type DepositSlipPairableRow,
} from "@/lib/banks/deposit-slip-row-pairing.shared";

function row(partial: Partial<DepositSlipPairableRow> & { id: string }): DepositSlipPairableRow {
  return {
    ocrName: "Commander",
    score: "6000",
    memberLevel: 3,
    allianceRankTitle: "LFgo",
    profession: "locked",
    frameIndex: null,
    ...partial,
  };
}

describe("pairDepositSlipTerminalRows", () => {
  it("pairs a matured row with its preceding locked row by name/amount/term", () => {
    const locked = row({ id: "locked-1", frameIndex: 50 });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      frameIndex: 10,
    });

    const { pairs, pairedRowIds } = pairDepositSlipTerminalRows([
      locked,
      matured,
    ]);

    expect(pairs).toEqual([{ locked, terminal: matured }]);
    expect(pairedRowIds).toEqual(new Set(["locked-1", "matured-1"]));
  });

  it("pairs a looted row even without frame indices", () => {
    const locked = row({ id: "locked-1" });
    const looted = row({ id: "looted-1", profession: "looted" });

    const { pairs } = pairDepositSlipTerminalRows([locked, looted]);

    expect(pairs).toEqual([{ locked, terminal: looted }]);
  });

  it("does not pair when the terminal row's frame comes after the locked row's", () => {
    const locked = row({ id: "locked-1", frameIndex: 10 });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      frameIndex: 50,
    });

    const { pairs, pairedRowIds } = pairDepositSlipTerminalRows([
      locked,
      matured,
    ]);

    expect(pairs).toEqual([]);
    expect(pairedRowIds.size).toBe(0);
  });

  it("does not pair rows with different alliance tags", () => {
    const locked = row({ id: "locked-1", allianceRankTitle: "LFgo" });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      allianceRankTitle: "OTHR",
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([]);
  });

  it("does not pair rows with different names", () => {
    const locked = row({ id: "locked-1", ocrName: "Manbridge" });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      ocrName: "Lady Raider",
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([]);
  });

  it("does not pair rows with different amounts when both are present", () => {
    const locked = row({ id: "locked-1", score: "6000" });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      score: "5000",
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([]);
  });

  it("does not pair rows with different terms when both are present", () => {
    const locked = row({ id: "locked-1", memberLevel: 3 });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      memberLevel: 7,
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([]);
  });

  it("does not pair when the terminal row has an empty commander name", () => {
    const locked = row({ id: "locked-1" });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      ocrName: "   ",
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([]);
  });

  it("still pairs when one side is missing amount or tag (best-effort)", () => {
    const locked = row({ id: "locked-1", score: null, allianceRankTitle: null });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      score: "6000",
      allianceRankTitle: "LFgo",
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured]);

    expect(pairs).toEqual([{ locked, terminal: matured }]);
  });

  it("picks the closest-by-frame locked candidate when multiple match", () => {
    const far = row({ id: "locked-far", frameIndex: 90 });
    const near = row({ id: "locked-near", frameIndex: 20 });
    const matured = row({
      id: "matured-1",
      profession: "matured",
      frameIndex: 10,
    });

    const { pairs } = pairDepositSlipTerminalRows([far, near, matured]);

    expect(pairs).toEqual([{ locked: near, terminal: matured }]);
  });

  it("does not double-pair a locked row to two terminal rows", () => {
    const locked = row({ id: "locked-1", frameIndex: 50 });
    const matured1 = row({
      id: "matured-1",
      profession: "matured",
      frameIndex: 10,
    });
    const matured2 = row({
      id: "matured-2",
      profession: "matured",
      frameIndex: 30,
    });

    const { pairs } = pairDepositSlipTerminalRows([locked, matured1, matured2]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.locked.id).toBe("locked-1");
  });

  it("leaves unmatched terminal rows unpaired", () => {
    const matured = row({ id: "matured-1", profession: "matured" });

    const { pairs, pairedRowIds } = pairDepositSlipTerminalRows([matured]);

    expect(pairs).toEqual([]);
    expect(pairedRowIds.size).toBe(0);
  });
});
