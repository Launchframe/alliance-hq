import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ active: vi.fn(), revisions: vi.fn() }));
vi.mock("./repository.server", () => ({ listActiveTimeOffEntries: mocks.active }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({ selectDistinctOn: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: mocks.revisions }) }) }) }) }),
  };
});

import { loadTimeOffAvailability } from "./availability.server";

describe("global duty availability contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revisions.mockResolvedValue([]);
    mocks.active.mockResolvedValue([]);
  });

  it("includes planned and unexpected global leave regardless of excusal or sync readiness", async () => {
    mocks.active.mockResolvedValue([
      { ashedMemberId: "planned", globalAbsence: true, entryKind: "planned", noticeVerified: true, syncStatus: "local" },
      { ashedMemberId: "unexpected", globalAbsence: true, entryKind: "unexpected", noticeVerified: false, syncStatus: "credentials_required" },
      { ashedMemberId: "activity-only", globalAbsence: false, entryKind: "planned", activityScope: "vs", noticeVerified: true, syncStatus: "synced" },
    ]);
    const availability = await loadTimeOffAvailability("native-alliance", "2099-06-20");
    expect(availability.awayMemberIds).toEqual(new Set(["planned", "unexpected"]));
    expect(availability.excusedMemberIds).toEqual(new Set());
    expect(mocks.active).toHaveBeenCalledWith({ allianceId: "native-alliance", rangeStart: "2099-06-20", rangeEnd: "2099-06-20" });
  });

  it("reloads active periods so cancellation or return restores availability", async () => {
    mocks.active.mockResolvedValueOnce([{ ashedMemberId: "member", globalAbsence: true }]);
    expect((await loadTimeOffAvailability("alliance", "2099-06-20")).awayMemberIds.has("member")).toBe(true);
    expect((await loadTimeOffAvailability("alliance", "2099-06-20")).awayMemberIds.has("member")).toBe(false);
  });

  it("rejects invalid duty calendar dates before querying", async () => {
    await expect(loadTimeOffAvailability("alliance", "2099-02-30")).rejects.toMatchObject({ code: "invalidDate" });
    expect(mocks.active).not.toHaveBeenCalled();
  });
});
