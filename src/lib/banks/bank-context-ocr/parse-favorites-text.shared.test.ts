import { describe, expect, it } from "vitest";

import { parseFavoritesText } from "@/lib/banks/bank-context-ocr/parse-favorites-text.shared";

const FAVORITES_LINES = [
  "ADD TO FAVORITES",
  "Warzone #1203 X:199 Y:599",
  "Lv.1 [BigD]Trailblazer Bank",
];

describe("parseFavoritesText", () => {
  it("parses golden favorites lines", () => {
    expect(parseFavoritesText(FAVORITES_LINES)).toEqual({
      gameServerNumber: 1203,
      coordX: 199,
      coordY: 599,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
    });
  });

  it("tolerates flexible warzone whitespace and Lv:1", () => {
    const lines = [
      "ADD TO FAVORITES",
      "Warzone  #1203  X: 199  Y: 599",
      "Lv:1 [BigD]Trailblazer Bank",
    ];
    expect(parseFavoritesText(lines)).toEqual({
      gameServerNumber: 1203,
      coordX: 199,
      coordY: 599,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
    });
  });

  it("tolerates missing spaces around tag brackets", () => {
    const lines = [
      "Warzone #1203 X:199 Y:599",
      "Lv.1[BigD]Trailblazer Bank",
    ];
    expect(parseFavoritesText(lines)?.owningAllianceTag).toBe("BigD");
    expect(parseFavoritesText(lines)?.bankName).toBe("Trailblazer Bank");
  });

  it("returns null when warzone coords are missing", () => {
    expect(parseFavoritesText(["ADD TO FAVORITES", "Lv.1 [BigD]Trailblazer Bank"])).toBeNull();
  });

  it("returns null for implausible coordinates", () => {
    expect(
      parseFavoritesText(["Warzone #1203 X:1999 Y:599"]),
    ).toBeNull();
    expect(
      parseFavoritesText(["Warzone #1203 X:199 Y:-1"]),
    ).toBeNull();
  });

  it("accepts V misread for Y in warzone line", () => {
    expect(parseFavoritesText(["Warzone #1203 X:199 V:599"])).toEqual({
      gameServerNumber: 1203,
      coordX: 199,
      coordY: 599,
      level: null,
      owningAllianceTag: null,
      bankName: null,
    });
  });
});
