import { describe, expect, it } from "vitest";

import {
  buildVsVideoMatchSubmission,
  chooseVsVideoSide,
  mergeVsVideoCandidate,
  seedVsVideoDraftForm,
  vsVideoScreenshotMatchPending,
  vsVideoScreenshotOwnTotal,
} from "./video-evidence-review.shared";
import {
  vsVideoDraftSchema,
  type VsVideoDraftForm,
  type VsVideoEvidenceResponse,
} from "./video-evidence.shared";
import type { VsSavedDayResult } from "./weekly-view.shared";
import type { VsCaptureCandidate } from "./vs-capture.shared";

const dailyCandidate: VsCaptureCandidate = {
  kind: "daily_totals",
  left: { server: 1203, tag: "LFgo", name: null },
  right: { server: 1236, tag: "TriV", name: "Trinity" },
  day: 2,
  leftScore: "2241713380",
  rightScore: "2222858900",
  leftPoints: null,
  rightPoints: null,
  dayResults: [],
  ongoing: false,
  partial: false,
};

const weeklyCandidate: VsCaptureCandidate = {
  kind: "weekly_overview",
  left: { server: 1203, tag: "LFgo", name: null },
  right: { server: 1236, tag: "TriV", name: null },
  day: null,
  leftScore: null,
  rightScore: null,
  leftPoints: 3,
  rightPoints: 0,
  dayResults: [1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    winner: "left" as const,
  })),
  ongoing: false,
  partial: false,
};

function response(over: {
  candidate?: VsCaptureCandidate | null;
  recordedDate?: string;
  period?: "daily" | "weekly";
  status?: VsVideoEvidenceResponse["evidence"]["status"];
  imageVersion?: number;
  fileName?: string | null;
  matchup?: VsVideoEvidenceResponse["matchup"];
  canEditMatch?: boolean;
  draftIsOwn?: boolean;
  draft?: VsVideoEvidenceResponse["evidence"]["draft"];
  today?: string;
}): VsVideoEvidenceResponse {
  return {
    evidence: {
      recordedDate: over.recordedDate ?? "2026-09-29",
      period: over.period ?? "daily",
      version: 3,
      imageVersion: over.imageVersion ?? 2,
      requestedKind: "auto",
      status: over.status ?? "ready",
      fileName: over.fileName === undefined ? "shot.png" : over.fileName,
      candidate: over.candidate === undefined ? dailyCandidate : over.candidate,
      errorCode: null,
      draft: over.draft ?? null,
      appliedImageVersion: null,
      previewUrl: "/api/tools/video-upload/job-1/vs-evidence/image",
    },
    canEditMatch: over.canEditMatch ?? true,
    canAttach: true,
    canWriteScores: true,
    canProcessImage: true,
    draftIsOwn: over.draftIsOwn ?? true,
    today: over.today ?? "2026-10-05",
    ashedLinked: false,
    canImportAshed: false,
    scoreSync: { status: "local", lastSyncedAt: null },
    scope: "scope:week",
    contextScope: "ctx",
    matchup: over.matchup ?? null,
    alliance: { tag: "LFgo", name: "Lifeguard", server: 1203 },
  };
}

const savedMatchup = {
  id: "m1",
  version: 4,
  opponentName: "Saved Opponent",
  opponentTag: "SvdO",
  opponentServer: 1240,
  opponentDailyScores: [null, null, null, null, null, null],
  weekOutcome: "pending",
  reportedOurPoints: null,
  reportedOpponentPoints: null,
  reportedPointsAt: null,
  days: [],
  conflicts: [],
  sync: {
    status: "idle",
    errorCode: null,
    lastSyncedAt: null,
    conflicts: [],
    conflictToken: null,
  },
} satisfies VsVideoEvidenceResponse["matchup"] as NonNullable<VsVideoEvidenceResponse["matchup"]>;

function seedableForm(response_: VsVideoEvidenceResponse): VsVideoDraftForm {
  const form = seedVsVideoDraftForm(response_);
  return {
    ...form,
    ourSide: "left",
    confirmSides: true,
    finalDay: true,
    day: 2,
  };
}

describe("seedVsVideoDraftForm", () => {
  it("seeds the exact side when only one tag matches the alliance", () => {
    const form = seedVsVideoDraftForm(response({}));
    expect(form.ourSide).toBe("left");
    expect(form.source).toBe("screenshot");
    expect(form.basisImageVersion).toBe(2);
    expect(form.leftScore).toBe("2241713380");
    expect(form.rightScore).toBe("2222858900");
    expect(form.opponent.tag).toBe("TriV");
  });

  it("leaves the side null when the tag matches neither or both", () => {
    const noMatch = response({ alliance: undefined } as never);
    noMatch.alliance.tag = "ZZZZ";
    expect(seedVsVideoDraftForm(noMatch).ourSide).toBeNull();
    const both = response({});
    both.evidence.candidate = {
      ...dailyCandidate,
      right: { ...dailyCandidate.right, tag: "LFgo" },
    };
    expect(seedVsVideoDraftForm(both).ourSide).toBeNull();
  });

  it("keeps the saved weekly opponent instead of the screenshot read", () => {
    const form = seedVsVideoDraftForm(
      response({ matchup: savedMatchup }),
    );
    expect(form.opponent).toEqual({
      server: 1240,
      tag: "SvdO",
      name: "Saved Opponent",
    });
  });

  it("seeds a manual source when no candidate exists", () => {
    const form = seedVsVideoDraftForm(response({ candidate: null }));
    expect(form.source).toBe("manual");
    expect(form.kind).toBeNull();
    expect(form.leftScore).toBe("");
    expect(form.rightScore).toBe("");
  });

  it("seeds a schema-valid daily draft with zeroed day versions", () => {
    const form = seedVsVideoDraftForm(response({}));
    expect(
      vsVideoDraftSchema.safeParse({
        includeResults: false,
        submission: null,
        form,
      }).success,
    ).toBe(true);
    expect(form.winners).toHaveLength(6);
    for (const date of [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]) {
      expect(form.expectedDayVersions[date]).toBe(0);
    }
  });

  it("preserves existing day head versions in the seeded draft", () => {
    const day: VsSavedDayResult = {
      id: "d1",
      recordedDate: "2026-09-29",
      totals: null,
      outcome: "pending",
      finality: "unconfirmed",
      version: 7,
      source: "hq_manual",
      hqConfirmed: false,
    };
    const form = seedVsVideoDraftForm(
      response({ matchup: { ...savedMatchup, days: [day] } }),
    );
    expect(form.expectedDayVersions["2026-09-29"]).toBe(7);
    expect(form.expectedDayVersions["2026-09-28"]).toBe(0);
  });
});

describe("chooseVsVideoSide / mergeVsVideoCandidate", () => {
  it("fills a missing own tag on explicit side choice", () => {
    const res = response({});
    const form = { ...seedVsVideoDraftForm(res), ourSide: null };
    const chosen = chooseVsVideoSide(form, res, "left");
    expect(chosen.ourSide).toBe("left");
    expect(chosen.left.tag).toBe("LFgo");
    expect(chosen.left.server).toBe(1203);
  });

  it("does not auto-correct a non-null misread own tag", () => {
    const res = response({});
    res.evidence.candidate = {
      ...dailyCandidate,
      left: { ...dailyCandidate.left, tag: "LFyo" },
    };
    const form = { ...seedVsVideoDraftForm(res), ourSide: null };
    const chosen = chooseVsVideoSide(form, res, "left");
    expect(chosen.left.tag).toBe("LFyo");
  });

  it("preserves the chosen side and opponent across candidate merges", () => {
    const res = response({});
    const form = chooseVsVideoSide(
      { ...seedVsVideoDraftForm(res), ourSide: null },
      res,
      "right",
    );
    const merged = mergeVsVideoCandidate(form, res);
    expect(merged.ourSide).toBe("right");
    expect(merged.opponent.tag).toBe(form.opponent.tag);
  });

  it("retains dirty fields but refreshes untouched candidate fields", () => {
    const res = response({});
    const form: VsVideoDraftForm = {
      ...seedVsVideoDraftForm(res),
      leftScore: "999",
      dirtyFields: ["leftScore"],
    };
    const nextRes = response({});
    nextRes.evidence.candidate = {
      ...dailyCandidate,
      leftScore: "111",
      day: 3,
      dayResults: [{ day: 1, winner: "right" as const }],
    };
    const merged = mergeVsVideoCandidate(form, nextRes);
    expect(merged.leftScore).toBe("999");
    expect(merged.day).toBe(3);
    expect(merged.winners[0]).toBe("right");
    expect(merged.expectedMatchupVersion).toBe(form.expectedMatchupVersion);
  });

  it("refreshes expected versions when the form has no dirty fields", () => {
    const res = response({ matchup: savedMatchup });
    const form = seedVsVideoDraftForm(res);
    const newer = response({ matchup: { ...savedMatchup, version: 9 } });
    const merged = mergeVsVideoCandidate(form, newer);
    expect(merged.expectedMatchupVersion).toBe(9);
  });
});

describe("vsVideoScreenshotMatchPending", () => {
  it("is pending while OCR has no ready candidate, so score save can omit match results", () => {
    const ready = response({});
    const form = seedableForm(ready);
    expect(vsVideoScreenshotMatchPending(ready, form)).toBe(false);
    for (const status of ["queued", "running", "failed", "needs_type"] as const) {
      expect(vsVideoScreenshotMatchPending(response({ status, candidate: null }), form)).toBe(true);
    }
    expect(vsVideoScreenshotMatchPending(response({ status: "queued" }), form)).toBe(true);
    expect(
      vsVideoScreenshotMatchPending(response({ status: "failed" }), { ...form, source: "manual" }),
    ).toBe(false);
  });
});

describe("buildVsVideoMatchSubmission", () => {
  it("returns undefined when includeResults is off", () => {
    const res = response({});
    expect(
      buildVsVideoMatchSubmission(
        res,
        { includeResults: false, submission: null, form: seedableForm(res) },
        "en-US",
      ),
    ).toBeUndefined();
  });

  it("forbids submissions without match-edit rights", () => {
    const res = response({ canEditMatch: false });
    expect(() =>
      buildVsVideoMatchSubmission(
        res,
        { includeResults: true, submission: null, form: seedableForm(res) },
        "en-US",
      ),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }));
  });

  it("returns undefined for an empty manual form", () => {
    const res = response({ candidate: null, fileName: null });
    const form = seedVsVideoDraftForm(res);
    expect(
      buildVsVideoMatchSubmission(
        res,
        { includeResults: true, submission: null, form },
        "en-US",
      ),
    ).toBeUndefined();
  });

  it("keeps the manual opponent score only in a daily context", () => {
    const res = response({ candidate: null, fileName: null });
    const form = {
      ...seedVsVideoDraftForm(res),
      opponentScore: "2222858900",
    };
    const submission = buildVsVideoMatchSubmission(
      res,
      { includeResults: true, submission: null, form },
      "en-US",
    );
    expect(submission?.data).toMatchObject({
      source: "manual",
      opponentScore: "2222858900",
    });
    const weeklyRes = response({
      candidate: null,
      fileName: null,
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    const weeklyForm = {
      ...seedVsVideoDraftForm(weeklyRes),
      opponentScore: "5",
    };
    expect(() =>
      buildVsVideoMatchSubmission(
        weeklyRes,
        { includeResults: true, submission: null, form: weeklyForm },
        "en-US",
      ),
    ).toThrowError(expect.objectContaining({ code: "context_mismatch" }));
  });

  it("rejects a screenshot review from another generation", () => {
    const res = response({ imageVersion: 3 });
    const form = seedableForm(response({}));
    expect(() =>
      buildVsVideoMatchSubmission(
        res,
        { includeResults: true, submission: null, form },
        "en-US",
      ),
    ).toThrowError(expect.objectContaining({ code: "stale" }));
  });

  it("requires explicit side confirmation", () => {
    const res = response({});
    const form = { ...seedableForm(res), confirmSides: false };
    expect(() =>
      buildVsVideoMatchSubmission(
        res,
        { includeResults: true, submission: null, form },
        "en-US",
      ),
    ).toThrowError(expect.objectContaining({ code: "capture_invalid" }));
  });

  it("preserves the parsed daily totals verbatim", () => {
    const res = response({});
    const submission = buildVsVideoMatchSubmission(
      res,
      { includeResults: true, submission: null, form: seedableForm(res) },
      "en-US",
    );
    expect(submission?.data).toMatchObject({
      source: "screenshot",
      imageVersion: 2,
      review: {
        kind: "daily_totals",
        weekStart: "2026-09-28",
        day: 2,
        leftScore: "2241713380",
        rightScore: "2222858900",
      },
    });
  });

  it("keeps weekly victory points as integers", () => {
    const res = response({
      candidate: weeklyCandidate,
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    const form = {
      ...seedVsVideoDraftForm(res),
      ourSide: "left" as const,
      confirmSides: true,
    };
    const submission = buildVsVideoMatchSubmission(
      res,
      { includeResults: true, submission: null, form },
      "en-US",
    );
    expect(submission?.data).toMatchObject({
      review: { kind: "weekly_overview", leftPoints: 3, rightPoints: 0 },
    });
  });

  it("rejects a daily review whose day does not match the context date", () => {
    const res = response({});
    const form = { ...seedableForm(res), day: 4 };
    expect(() =>
      buildVsVideoMatchSubmission(
        res,
        { includeResults: true, submission: null, form },
        "en-US",
      ),
    ).toThrowError(expect.objectContaining({ code: "context_mismatch" }));
  });
});

describe("vsVideoScreenshotOwnTotal", () => {
  it("is hidden without an image or for weekly kinds/contexts", () => {
    expect(
      vsVideoScreenshotOwnTotal(
        response({ fileName: null, candidate: null }),
        null,
        "en-US",
      ).visible,
    ).toBe(false);
    const res = response({ candidate: weeklyCandidate });
    const form = seedVsVideoDraftForm(res);
    expect(
      vsVideoScreenshotOwnTotal(res, form, "en-US").visible,
    ).toBe(false);
    expect(
      vsVideoScreenshotOwnTotal(
        response({ recordedDate: "2026-10-04", period: "weekly" }),
        form,
        "en-US",
      ).visible,
    ).toBe(false);
  });

  it("returns the own-side total once a side is chosen", () => {
    const res = response({});
    const form = { ...seedVsVideoDraftForm(res), ourSide: "left" as const };
    expect(vsVideoScreenshotOwnTotal(res, form, "en-US")).toEqual({
      visible: true,
      total: "2241713380",
    });
  });

  it("stays visible but null while the side is unknown or processing pending", () => {
    const res = response({});
    const form = seedVsVideoDraftForm(res);
    expect(form.ourSide).toBe("left");
    const noSide = { ...form, ourSide: null };
    expect(
      vsVideoScreenshotOwnTotal(res, noSide, "en-US"),
    ).toEqual({ visible: true, total: null });
    expect(
      vsVideoScreenshotOwnTotal(
        response({ status: "queued" }),
        form,
        "en-US",
      ),
    ).toEqual({ visible: true, total: null });
  });

  it("keeps a zero score instead of treating it as missing", () => {
    const res = response({});
    const form = {
      ...seedVsVideoDraftForm(res),
      ourSide: "left" as const,
      leftScore: "0",
    };
    expect(vsVideoScreenshotOwnTotal(res, form, "en-US")).toEqual({
      visible: true,
      total: "0",
    });
  });
});
