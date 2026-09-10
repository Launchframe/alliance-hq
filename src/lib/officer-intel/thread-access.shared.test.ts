import { describe, expect, it } from "vitest";

import {
  canContinueOfficerIntelThread,
  shouldIndexOfficerIntelNoteCorpus,
} from "@/lib/officer-intel/thread-access.shared";

describe("canContinueOfficerIntelThread", () => {
  it("requires a requester HQ user", () => {
    expect(
      canContinueOfficerIntelThread({
        createdByHqUserId: "u1",
        requesterHqUserId: null,
      }),
    ).toBe(false);
  });

  it("allows the creating officer only", () => {
    expect(
      canContinueOfficerIntelThread({
        createdByHqUserId: "u1",
        requesterHqUserId: "u1",
      }),
    ).toBe(true);
    expect(
      canContinueOfficerIntelThread({
        createdByHqUserId: "u1",
        requesterHqUserId: "u2",
      }),
    ).toBe(false);
  });

  it("allows alliance officers to continue unowned threads after user delete", () => {
    expect(
      canContinueOfficerIntelThread({
        createdByHqUserId: null,
        requesterHqUserId: "u2",
      }),
    ).toBe(true);
  });
});

describe("shouldIndexOfficerIntelNoteCorpus", () => {
  it("indexes on approve even when the note was a draft", () => {
    expect(
      shouldIndexOfficerIntelNoteCorpus({
        approve: true,
        existingStatus: "draft",
      }),
    ).toBe(true);
  });

  it("re-indexes later edits of an already-approved note", () => {
    expect(
      shouldIndexOfficerIntelNoteCorpus({
        approve: false,
        existingStatus: "approved",
      }),
    ).toBe(true);
    expect(
      shouldIndexOfficerIntelNoteCorpus({
        existingStatus: "approved",
      }),
    ).toBe(true);
  });

  it("does not index draft edits without approve", () => {
    expect(
      shouldIndexOfficerIntelNoteCorpus({
        approve: false,
        existingStatus: "draft",
      }),
    ).toBe(false);
  });
});
