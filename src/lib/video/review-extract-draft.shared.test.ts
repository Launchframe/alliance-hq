import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildVideoReviewDraft,
  clearVideoReviewDraftFromStorage,
  computeVideoReviewRowSignature,
  isVideoReviewDraftApplicable,
  mergeVideoReviewDraftRows,
  parseVideoReviewDraft,
  readVideoReviewDraftFromStorage,
  restoreVideoReviewDraftIfPresent,
  shouldAutosaveVideoReviewDraft,
  videoReviewDraftStorageKey,
  writeVideoReviewDraftToStorage,
} from "./review-extract-draft.shared";

const baseRow = {
  id: "r1",
  ocrName: "Alpha",
  score: "100",
  rank: 1,
  memberId: "m1",
  memberName: "Alpha",
  matchConfidence: 1,
  matchMethod: "exact",
  scoreConflict: 0,
  deleted: 0,
};

const baseForm = {
  eventId: "ev-1",
  hqEventId: "hq-1",
  boardKey: "kills",
  team: "A" as const,
  recordedDate: "2026-06-26",
  bankId: "",
};

function makeDraft(overrides?: Partial<ReturnType<typeof buildVideoReviewDraft>>) {
  return buildVideoReviewDraft({
    jobId: "job-1",
    viewMode: "review",
    rows: [baseRow],
    form: baseForm,
    savedAt: "2026-06-26T12:00:00.000Z",
    ...overrides,
  });
}

describe("videoReviewDraftStorageKey", () => {
  it("includes job id and view mode", () => {
    expect(videoReviewDraftStorageKey("job-1", "review")).toBe(
      "hq-video-review-draft-v1:job-1:review",
    );
  });
});

describe("computeVideoReviewRowSignature", () => {
  it("sorts row ids for a stable signature", () => {
    expect(
      computeVideoReviewRowSignature([{ id: "b" }, { id: "a" }]),
    ).toBe("a,b");
  });

  it("returns empty string for no rows", () => {
    expect(computeVideoReviewRowSignature([])).toBe("");
  });
});

describe("buildVideoReviewDraft", () => {
  it("uses provided savedAt when set", () => {
    const draft = buildVideoReviewDraft({
      jobId: "job-1",
      viewMode: "review",
      rows: [baseRow],
      form: baseForm,
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(draft.savedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("defaults savedAt to now when omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T15:00:00.000Z"));
    const draft = buildVideoReviewDraft({
      jobId: "job-1",
      viewMode: "review",
      rows: [baseRow],
      form: baseForm,
    });
    expect(draft.savedAt).toBe("2026-06-26T15:00:00.000Z");
    vi.useRealTimers();
  });
});

describe("parseVideoReviewDraft", () => {
  it("parses a valid draft payload", () => {
    const draft = makeDraft();
    expect(parseVideoReviewDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("rejects malformed payloads", () => {
    expect(parseVideoReviewDraft("{")).toBeNull();
    expect(parseVideoReviewDraft(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseVideoReviewDraft(JSON.stringify(null))).toBeNull();
    expect(parseVideoReviewDraft(JSON.stringify({ version: 1 }))).toBeNull();
    expect(
      parseVideoReviewDraft(
        JSON.stringify({
          ...makeDraft(),
          viewMode: "invalid",
        }),
      ),
    ).toBeNull();
    expect(
      parseVideoReviewDraft(
        JSON.stringify({
          ...makeDraft(),
          rows: [{ id: "x" }],
        }),
      ),
    ).toBeNull();
    expect(
      parseVideoReviewDraft(
        JSON.stringify({
          ...makeDraft(),
          team: "C",
        }),
      ),
    ).toBeNull();
  });

  it("rejects drafts with invalid scalar fields", () => {
    for (const field of [
      "jobId",
      "rowSignature",
      "eventId",
      "hqEventId",
      "boardKey",
      "recordedDate",
    ] as const) {
      const payload = { ...makeDraft(), [field]: 123 };
      expect(parseVideoReviewDraft(JSON.stringify(payload))).toBeNull();
    }
    expect(
      parseVideoReviewDraft(JSON.stringify({ ...makeDraft(), rows: "nope" })),
    ).toBeNull();
    expect(
      parseVideoReviewDraft(JSON.stringify({ ...makeDraft(), rows: [null] })),
    ).toBeNull();
  });
});

describe("isVideoReviewDraftApplicable", () => {
  it("requires matching job, view mode, and row signature", () => {
    const draft = makeDraft();
    const signature = computeVideoReviewRowSignature([baseRow]);
    expect(
      isVideoReviewDraftApplicable(draft, "job-1", "review", signature),
    ).toBe(true);
    expect(
      isVideoReviewDraftApplicable(draft, "job-2", "review", signature),
    ).toBe(false);
    expect(
      isVideoReviewDraftApplicable(draft, "job-1", "event", signature),
    ).toBe(false);
    expect(
      isVideoReviewDraftApplicable(draft, "job-1", "review", "other"),
    ).toBe(false);
    expect(isVideoReviewDraftApplicable(draft, "job-1", "review", "")).toBe(
      false,
    );
  });
});

describe("shouldAutosaveVideoReviewDraft", () => {
  it("waits for a reviewer change after autosave is armed", () => {
    expect(
      shouldAutosaveVideoReviewDraft({
        enabled: true,
        autosaveReady: true,
        dirtyVersion: 0,
        baselineDirtyVersion: 0,
        rowCount: 1,
      }),
    ).toBe(false);

    expect(
      shouldAutosaveVideoReviewDraft({
        enabled: true,
        autosaveReady: true,
        dirtyVersion: 1,
        baselineDirtyVersion: 0,
        rowCount: 1,
      }),
    ).toBe(true);
  });

  it("does not save after clear disables autosave", () => {
    expect(
      shouldAutosaveVideoReviewDraft({
        enabled: true,
        autosaveReady: false,
        dirtyVersion: 2,
        baselineDirtyVersion: 1,
        rowCount: 1,
      }),
    ).toBe(false);
  });

  it("does not save when the draft surface is disabled or empty", () => {
    expect(
      shouldAutosaveVideoReviewDraft({
        enabled: false,
        autosaveReady: true,
        dirtyVersion: 1,
        baselineDirtyVersion: 0,
        rowCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldAutosaveVideoReviewDraft({
        enabled: true,
        autosaveReady: true,
        dirtyVersion: 1,
        baselineDirtyVersion: 0,
        rowCount: 0,
      }),
    ).toBe(false);
  });
});

describe("mergeVideoReviewDraftRows", () => {
  it("overlays draft edits onto server rows by id", () => {
    const merged = mergeVideoReviewDraftRows(
      [{ ...baseRow, score: "50" }],
      [{ ...baseRow, score: "999" }],
    );
    expect(merged[0]?.score).toBe("999");
  });

  it("keeps server rows when draft has no matching id", () => {
    const merged = mergeVideoReviewDraftRows(
      [{ ...baseRow, score: "50" }],
      [{ ...baseRow, id: "other", score: "999" }],
    );
    expect(merged[0]?.score).toBe("50");
  });
});

describe("localStorage draft persistence", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips drafts through storage helpers", () => {
    const draft = makeDraft();
    writeVideoReviewDraftToStorage(draft);
    expect(readVideoReviewDraftFromStorage("job-1", "review")).toEqual(draft);
    clearVideoReviewDraftFromStorage("job-1", "review");
    expect(readVideoReviewDraftFromStorage("job-1", "review")).toBeNull();
  });

  it("ignores invalid stored payloads", () => {
    store.set(videoReviewDraftStorageKey("job-1", "review"), "{");
    expect(readVideoReviewDraftFromStorage("job-1", "review")).toBeNull();
  });

  it("swallows storage write failures", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    expect(() => writeVideoReviewDraftToStorage(makeDraft())).not.toThrow();
  });

  it("swallows storage read failures", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readVideoReviewDraftFromStorage("job-1", "review")).toBeNull();
  });

  it("swallows storage clear failures", () => {
    vi.stubGlobal("window", {
      localStorage: {
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() =>
      clearVideoReviewDraftFromStorage("job-1", "review"),
    ).not.toThrow();
  });
});

describe("restoreVideoReviewDraftIfPresent", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns server rows when no draft exists", () => {
    const serverRows = [baseRow];
    const result = restoreVideoReviewDraftIfPresent(
      "missing-job",
      "review",
      serverRows,
    );
    expect(result.restored).toBe(false);
    expect(result.rows).toEqual(serverRows);
    expect(result.savedAt).toBeNull();
    expect(result.form).toBeNull();
  });

  it("merges draft rows and form when applicable", () => {
    const draft = makeDraft({
      rows: [{ ...baseRow, score: "777" }],
    });
    writeVideoReviewDraftToStorage(draft);
    const serverRows = [{ ...baseRow, score: "100" }];
    const result = restoreVideoReviewDraftIfPresent(
      "job-1",
      "review",
      serverRows,
    );
    expect(result.restored).toBe(true);
    expect(result.rows[0]?.score).toBe("777");
    expect(result.form).toEqual(baseForm);
    expect(result.savedAt).toBe("2026-06-26T12:00:00.000Z");
  });

  it("returns null savedAt when draft omits savedAt", () => {
    const draft = { ...makeDraft(), savedAt: undefined };
    store.set(
      videoReviewDraftStorageKey("job-1", "review"),
      JSON.stringify(draft),
    );
    const result = restoreVideoReviewDraftIfPresent("job-1", "review", [
      baseRow,
    ]);
    expect(result.restored).toBe(true);
    expect(result.savedAt).toBeNull();
  });

  it("rejects drafts with mismatched row signatures", () => {
    const draft = makeDraft({
      rows: [{ ...baseRow, id: "stale" }],
    });
    writeVideoReviewDraftToStorage(draft);
    const result = restoreVideoReviewDraftIfPresent("job-1", "review", [
      baseRow,
    ]);
    expect(result.restored).toBe(false);
    expect(result.rows).toEqual([baseRow]);
  });
});

describe("storage helpers without window", () => {
  it("no-op when window is undefined", () => {
    expect(readVideoReviewDraftFromStorage("job-1", "review")).toBeNull();
    expect(() => writeVideoReviewDraftToStorage(makeDraft())).not.toThrow();
    expect(() =>
      clearVideoReviewDraftFromStorage("job-1", "review"),
    ).not.toThrow();
  });
});
