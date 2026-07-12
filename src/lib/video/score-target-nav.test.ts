import { describe, expect, it } from "vitest";

import {
  buildVideoUploadHref,
  getScoreTargetIdForNavHref,
  jobMatchesScoreTarget,
  parseVideoUploadBankIdParam,
  parseVideoUploadScoreTargetParam,
} from "@/lib/video/score-target-nav";

describe("score-target-nav", () => {
  it("maps iframe nav hrefs to enabled score targets", () => {
    expect(getScoreTargetIdForNavHref("/desert-storm")).toBe("desert-storm");
    expect(getScoreTargetIdForNavHref("/seasonal-events")).toBe("seasonal");
    expect(getScoreTargetIdForNavHref("/members")).toBeNull();
  });

  it("builds upload URL with scoreTarget query param", () => {
    expect(buildVideoUploadHref("canyon-storm")).toBe(
      "/tools/video-upload?scoreTarget=canyon-storm",
    );
  });

  it("builds upload URL with optional boardKey", () => {
    expect(
      buildVideoUploadHref("seasonal", {
        boardKey: "kills",
      }),
    ).toBe("/tools/video-upload?scoreTarget=seasonal&boardKey=kills");
  });

  it("builds upload URL with optional bankId", () => {
    expect(
      buildVideoUploadHref("bank-deposit-slip-history", {
        bankId: "bank_abc",
      }),
    ).toBe(
      "/tools/video-upload?scoreTarget=bank-deposit-slip-history&bankId=bank_abc",
    );
  });

  it("parses enabled scoreTarget query values only", () => {
    expect(parseVideoUploadScoreTargetParam("donations")).toBe("donations");
    expect(parseVideoUploadScoreTargetParam("alliance-star")).toBeNull();
    expect(parseVideoUploadScoreTargetParam("")).toBeNull();
  });

  it("parses optional bankId query values", () => {
    expect(parseVideoUploadBankIdParam("bank_abc")).toBe("bank_abc");
    expect(parseVideoUploadBankIdParam("  bank_abc  ")).toBe("bank_abc");
    expect(parseVideoUploadBankIdParam("")).toBeNull();
    expect(parseVideoUploadBankIdParam(undefined)).toBeNull();
  });

  it("matches jobs on scoreTarget or legacy category", () => {
    expect(
      jobMatchesScoreTarget({ scoreTarget: "vs-performance" }, "vs-performance"),
    ).toBe(true);
    expect(
      jobMatchesScoreTarget({ category: "desert-storm" }, "desert-storm"),
    ).toBe(true);
    expect(
      jobMatchesScoreTarget({ scoreTarget: "donations" }, "vs-performance"),
    ).toBe(false);
  });
});
