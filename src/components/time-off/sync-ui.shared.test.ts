import { describe, expect, it } from "vitest";

import { timeOffSyncErrorKey, timeOffSyncReviewSchema, timeOffSyncStatusKey } from "./sync-ui.shared";

const review = {
  version: 4,
  bindings: [{
    id: "binding-a",
    recordType: "vs",
    status: "uncertain",
    fingerprint: "review-fingerprint",
    remote: null,
    candidates: [
      { id: "period-a", fingerprint: "candidate-a", startDate: "2026-09-01", endDate: "2026-09-03", recordType: "vs" },
      { id: "period-b", fingerprint: "candidate-b", startDate: "2026-09-01", endDate: "2026-09-03", recordType: "vs", createdAt: "2026-08-31T12:00:00Z" },
    ],
  }],
};

describe("time-off sync status copy", () => {
  it.each([
    ["local", "sync.localOnly"],
    ["pending", "sync.pending"],
    ["synced", "sync.synced"],
    ["failed", "sync.failed"],
    ["cancel_pending", "sync.cancelPending"],
    ["credentials_required", "sync.credentialsRequired"],
    ["conflict", "sync.conflict"],
    ["uncertain", "sync.uncertain"],
    ["unknown", "sync.actionFailed"],
    ["toString", "sync.actionFailed"],
    ["__proto__", "sync.actionFailed"],
  ])("maps %s to %s", (status, key) => {
    expect(timeOffSyncStatusKey(status)).toBe(key);
  });

  it("uses localized permission and recovery messages, not arbitrary server text", () => {
    expect(timeOffSyncErrorKey(null, 403)).toBe("workflow.errors.forbidden");
    expect(timeOffSyncErrorKey({ code: "forbidden" })).toBe("workflow.errors.forbidden");
    expect(timeOffSyncErrorKey({ code: "officerOnly" })).toBe("workflow.errors.officerOnly");
    expect(timeOffSyncErrorKey({ code: "staleEntry" })).toBe("workflow.errors.staleEntry");
    expect(timeOffSyncErrorKey({ code: "entryUnavailable" })).toBe("workflow.errors.entryUnavailable");
    expect(timeOffSyncErrorKey({ code: "credentials_required" })).toBe("sync.credentialsRequired");
    expect(timeOffSyncErrorKey({ code: "ashed_not_connected" })).toBe("sync.credentialsRequired");
    expect(timeOffSyncErrorKey({ error: "untrusted server detail", code: "unrecognized" }, 500)).toBe("sync.actionFailed");
    expect(timeOffSyncErrorKey(null)).toBe("sync.actionFailed");
  });
});

describe("time-off sync review payload", () => {
  it("retains all ambiguous candidates without choosing a match", () => {
    const parsed = timeOffSyncReviewSchema.parse(review);
    expect(parsed).toEqual(review);
    expect(parsed.bindings[0].candidates.map((candidate) => candidate.id)).toEqual(["period-a", "period-b"]);
  });

  it("keeps only the allowed review fields", () => {
    const parsed = timeOffSyncReviewSchema.parse({
      ...review,
      notes: "private fixture",
      gameUid: "redacted",
      bindings: review.bindings.map((binding) => ({
        ...binding,
        notes: "private fixture",
        remote: { startDate: "2026-09-01", endDate: "2026-09-03", recordType: "vs", notes: "private fixture" },
        candidates: binding.candidates.map((candidate) => ({ ...candidate, gameUid: "redacted", notes: "private fixture" })),
      })),
    });
    expect(parsed).not.toHaveProperty("notes");
    expect(parsed).not.toHaveProperty("gameUid");
    expect(parsed.bindings[0]).not.toHaveProperty("notes");
    expect(parsed.bindings[0].remote).not.toHaveProperty("notes");
    expect(parsed.bindings[0].candidates[0]).not.toHaveProperty("notes");
    expect(parsed.bindings[0].candidates[0]).not.toHaveProperty("gameUid");
  });

  it("rejects unknown response shapes and invalid dates before rendering", () => {
    expect(timeOffSyncReviewSchema.safeParse(null).success).toBe(false);
    expect(timeOffSyncReviewSchema.safeParse({ ok: true }).success).toBe(false);
    expect(timeOffSyncReviewSchema.safeParse({ ...review, version: "4" }).success).toBe(false);
    expect(timeOffSyncReviewSchema.safeParse({ ...review, bindings: [{ ...review.bindings[0], fingerprint: undefined }] }).success).toBe(false);
    expect(timeOffSyncReviewSchema.safeParse({
      ...review,
      bindings: [{ ...review.bindings[0], remote: { recordType: "vs", startDate: "invalid", endDate: "2026-09-03" } }],
    }).success).toBe(false);
  });
});
