import { describe, expect, it } from "vitest";

import {
  deriveApprovedAtFromLiveUpdate,
  deriveRejectedAt,
  shouldShowRecentUploadJob,
} from "./recent-upload-jobs.shared";

describe("shouldShowRecentUploadJob", () => {
  it("shows non-discarded jobs", () => {
    expect(
      shouldShowRecentUploadJob({ status: "pending_approval", approvedAt: null }),
    ).toBe(true);
    expect(
      shouldShowRecentUploadJob({
        status: "complete",
        approvedAt: "2026-07-13T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("shows processor rejects (discarded without approval)", () => {
    expect(
      shouldShowRecentUploadJob({ status: "discarded", approvedAt: null }),
    ).toBe(true);
  });

  it("hides self-discards after OCR (discarded with approval)", () => {
    expect(
      shouldShowRecentUploadJob({
        status: "discarded",
        approvedAt: "2026-07-13T09:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("deriveRejectedAt", () => {
  it("returns updatedAt for processor rejects", () => {
    expect(
      deriveRejectedAt({
        status: "discarded",
        approvedAt: null,
        updatedAt: "2026-07-13T11:00:00.000Z",
      }),
    ).toBe("2026-07-13T11:00:00.000Z");
  });

  it("returns null for non-discarded and post-approval discards", () => {
    expect(
      deriveRejectedAt({
        status: "pending_approval",
        approvedAt: null,
        updatedAt: "2026-07-13T11:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      deriveRejectedAt({
        status: "discarded",
        approvedAt: "2026-07-13T09:00:00.000Z",
        updatedAt: "2026-07-13T11:00:00.000Z",
      }),
    ).toBeNull();
  });
});

describe("deriveApprovedAtFromLiveUpdate", () => {
  it("preserves an existing approvedAt", () => {
    expect(
      deriveApprovedAtFromLiveUpdate({
        previousStatus: "pending_approval",
        nextStatus: "queued",
        existingApprovedAt: "2026-07-13T08:00:00.000Z",
        liveUpdatedAt: "2026-07-13T09:00:00.000Z",
      }),
    ).toBe("2026-07-13T08:00:00.000Z");
  });

  it("infers approvedAt when pending_approval moves into processing", () => {
    expect(
      deriveApprovedAtFromLiveUpdate({
        previousStatus: "pending_approval",
        nextStatus: "queued",
        existingApprovedAt: null,
        liveUpdatedAt: "2026-07-13T09:00:00.000Z",
      }),
    ).toBe("2026-07-13T09:00:00.000Z");
    expect(
      deriveApprovedAtFromLiveUpdate({
        previousStatus: "pending_approval",
        nextStatus: "parsing",
        existingApprovedAt: null,
        liveUpdatedAt: "2026-07-13T09:05:00.000Z",
      }),
    ).toBe("2026-07-13T09:05:00.000Z");
  });

  it("does not infer approvedAt for unrelated transitions", () => {
    expect(
      deriveApprovedAtFromLiveUpdate({
        previousStatus: "queued",
        nextStatus: "parsing",
        existingApprovedAt: null,
        liveUpdatedAt: "2026-07-13T09:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      deriveApprovedAtFromLiveUpdate({
        previousStatus: "pending_approval",
        nextStatus: "discarded",
        existingApprovedAt: null,
        liveUpdatedAt: "2026-07-13T09:00:00.000Z",
      }),
    ).toBeUndefined();
  });
});
