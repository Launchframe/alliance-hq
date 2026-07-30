import { describe, expect, it } from "vitest";

import {
  bankMatchesCoordQuery,
  parseBankCoordQuery,
} from "@/lib/banks/bank-list-search.shared";

describe("parseBankCoordQuery", () => {
  it("returns empty for blank input", () => {
    expect(parseBankCoordQuery("")).toEqual({ kind: "empty" });
    expect(parseBankCoordQuery("   ")).toEqual({ kind: "empty" });
  });

  it("parses X/Y pairs in common shapes", () => {
    expect(parseBankCoordQuery("699 20")).toEqual({
      kind: "xy",
      x: 699,
      y: 20,
    });
    expect(parseBankCoordQuery("699,20")).toEqual({
      kind: "xy",
      x: 699,
      y: 20,
    });
    expect(parseBankCoordQuery("X:699 Y:20")).toEqual({
      kind: "xy",
      x: 699,
      y: 20,
    });
    expect(parseBankCoordQuery("(699, 20)")).toEqual({
      kind: "xy",
      x: 699,
      y: 20,
    });
  });

  it("parses a single number as either-axis lookup", () => {
    expect(parseBankCoordQuery("699")).toEqual({
      kind: "single",
      value: 699,
    });
  });
});

describe("bankMatchesCoordQuery", () => {
  const bank = { coordX: 699, coordY: 20 };

  it("matches all banks when the query is empty", () => {
    expect(bankMatchesCoordQuery(bank, "")).toBe(true);
  });

  it("matches exact X+Y", () => {
    expect(bankMatchesCoordQuery(bank, "699 20")).toBe(true);
    expect(bankMatchesCoordQuery(bank, "698 20")).toBe(false);
  });

  it("matches either axis for a single number", () => {
    expect(bankMatchesCoordQuery(bank, "699")).toBe(true);
    expect(bankMatchesCoordQuery(bank, "20")).toBe(true);
    expect(bankMatchesCoordQuery(bank, "21")).toBe(false);
  });

  it("matches past-drop banks the same way (no status in the matcher)", () => {
    expect(bankMatchesCoordQuery({ coordX: 899, coordY: 978 }, "899 978")).toBe(
      true,
    );
  });
});
