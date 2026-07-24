import { describe, expect, it } from "vitest";

import {
  defaultTopNForPaintTemplate,
  isAutomaticTopNBoard,
  isVrTopScopeUnlocked,
  resolveConductorTopNBoard,
  vrReportersRequiredForTopN,
} from "@/lib/trains/conductor-top-n.shared";

describe("resolveConductorTopNBoard", () => {
  it("maps legacy VS mechanisms", () => {
    expect(resolveConductorTopNBoard("vs_high_score")).toEqual({
      kind: "vs",
      topN: 1,
      mechanism: "vs_high_score",
    });
    expect(resolveConductorTopNBoard("vs_top_10")).toEqual({
      kind: "vs",
      topN: 10,
      mechanism: "vs_top_10",
    });
  });

  it("reads topN from conductor_config for vs_top_n / vr_top_n", () => {
    expect(
      resolveConductorTopNBoard("vs_top_n", { topN: 5, paintTemplate: "top_vs" }),
    ).toEqual({ kind: "vs", topN: 5, mechanism: "vs_top_n" });
    expect(resolveConductorTopNBoard("vr_top_n", { topN: 10 })).toEqual({
      kind: "vr",
      topN: 10,
      mechanism: "vr_top_n",
    });
  });

  it("defaults vs_top_n to 10 and vr_top_n to 3 when topN missing", () => {
    expect(resolveConductorTopNBoard("vs_top_n", { paintTemplate: "top_vs" })).toEqual(
      {
        kind: "vs",
        topN: 10,
        mechanism: "vs_top_n",
      },
    );
    expect(resolveConductorTopNBoard("vr_top_n")).toEqual({
      kind: "vr",
      topN: 3,
      mechanism: "vr_top_n",
    });
  });

  it("ignores invalid VR topN 1", () => {
    expect(resolveConductorTopNBoard("vr_top_n", { topN: 1 })).toEqual({
      kind: "vr",
      topN: 3,
      mechanism: "vr_top_n",
    });
  });
});

describe("isVrTopScopeUnlocked", () => {
  it("requires 2×N reporters", () => {
    expect(isVrTopScopeUnlocked(3, 5)).toBe(false);
    expect(isVrTopScopeUnlocked(3, 6)).toBe(true);
    expect(isVrTopScopeUnlocked(5, 10)).toBe(true);
    expect(isVrTopScopeUnlocked(10, 19)).toBe(false);
    expect(vrReportersRequiredForTopN(10)).toBe(20);
  });

  it("locks all scopes for a thin board (e.g. 3 reporters)", () => {
    expect(isVrTopScopeUnlocked(3, 3)).toBe(false);
    expect(isVrTopScopeUnlocked(5, 3)).toBe(false);
    expect(isVrTopScopeUnlocked(10, 3)).toBe(false);
  });
});

describe("paint defaults", () => {
  it("defaults Top VS to 10 and Top VR to 3", () => {
    expect(defaultTopNForPaintTemplate("top_vs")).toBe(10);
    expect(defaultTopNForPaintTemplate("top_vr")).toBe(3);
  });

  it("marks topN 1 as automatic", () => {
    expect(
      isAutomaticTopNBoard(resolveConductorTopNBoard("vs_high_score")),
    ).toBe(true);
    expect(isAutomaticTopNBoard(resolveConductorTopNBoard("vs_top_10"))).toBe(
      false,
    );
  });
});
