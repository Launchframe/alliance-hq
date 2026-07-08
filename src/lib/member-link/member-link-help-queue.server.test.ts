import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";

import {
  recordMemberLinkHelpRequest,
  resolveDiscordHelpContext,
  resolveWebHelpContext,
} from "./member-link-help-queue.server";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

function selectReturning(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(result),
      }),
    }),
  };
}

describe("member link help context", () => {
  it("maps roster_miss pending to roster_miss context", () => {
    expect(
      resolveWebHelpContext({ kind: "link_roster_miss" }),
    ).toBe("roster_miss");
    expect(
      resolveDiscordHelpContext({ kind: "link_roster_miss" }),
    ).toBe("roster_miss");
  });

  it("maps walkthrough pending to walkthrough context", () => {
    expect(
      resolveWebHelpContext({
        kind: "link_walkthrough",
        step: 1,
      } as { kind: string }),
    ).toBe("walkthrough");
  });

  it("defaults web to onboarding_form and discord to discord_button", () => {
    expect(resolveWebHelpContext(null)).toBe("onboarding_form");
    expect(resolveDiscordHelpContext(null)).toBe("discord_button");
  });
});

describe("recordMemberLinkHelpRequest claim_conflict dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new claim conflict help row when none is open for the tuple", async () => {
    let inserted: Record<string, unknown> | undefined;
    const insertValues = vi.fn((values: Record<string, unknown>) => {
      if ("context" in values) inserted = values;
      return Promise.resolve();
    });
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([])),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    } as never);

    const id = await recordMemberLinkHelpRequest({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      origin: "web",
      context: "claim_conflict",
      requesterHandle: "maverick@example.com",
      reportedName: "Maverick",
      gameUid: "1001369694001203",
      gameUserName: "Maverick",
      targetAshedMemberId: "member-1",
      claimConflictReason: "name_collision",
    });

    expect(id).toBeTruthy();
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(inserted?.allianceId).toBe("alliance-1");
    expect(inserted?.linkedAshedMemberId).toBe("member-1");
    expect(inserted?.claimConflictReason).toBe("name_collision");
    expect(inserted?.status).toBe("open");
  });

  it("updates the existing open claim conflict instead of inserting a duplicate", async () => {
    const updateWhere = vi.fn(() => Promise.resolve());
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const insertValues = vi.fn(() => Promise.resolve());
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([{ id: "help-1" }])),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const id = await recordMemberLinkHelpRequest({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      origin: "web",
      context: "claim_conflict",
      requesterHandle: "maverick@example.com",
      reportedName: "Maverick",
      gameUid: "1001369694001203",
      gameUserName: "Maverick",
      targetAshedMemberId: "member-1",
      claimConflictReason: "name_collision",
    });

    expect(id).toBe("help-1");
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledTimes(2);
  });

  it("deduplicates cross_layer_claim retries on the same commander tuple", async () => {
    const updateWhere = vi.fn(() => Promise.resolve());
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const insertValues = vi.fn(() => Promise.resolve());
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => selectReturning([{ id: "help-cross" }])),
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    } as never);

    const id = await recordMemberLinkHelpRequest({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      origin: "web",
      context: "cross_layer_claim",
      requesterHandle: "player@example.com",
      reportedName: "Alpha",
      gameUid: "1001369694001203",
      gameUserName: "Alpha",
      targetAshedMemberId: "member-1",
      claimConflictReason: "discord_hq_unlinked",
    });

    expect(id).toBe("help-cross");
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledTimes(2);
  });

  it("recovers when a concurrent insert wins the open claim conflict unique race", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    let helpInsertCalls = 0;
    const insertValues = vi.fn((values: Record<string, unknown>) => {
      if ("context" in values) {
        helpInsertCalls += 1;
        if (helpInsertCalls === 1) return Promise.reject(uniqueError);
      }
      return Promise.resolve();
    });
    const updateWhere = vi.fn(() => Promise.resolve());
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const selectFn = vi
      .fn()
      .mockReturnValueOnce(selectReturning([]))
      .mockReturnValueOnce(selectReturning([{ id: "help-race" }]));
    vi.mocked(getDb).mockReturnValue({
      select: selectFn,
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    } as never);

    const id = await recordMemberLinkHelpRequest({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      origin: "web",
      context: "claim_conflict",
      requesterHandle: "maverick@example.com",
      reportedName: "Maverick",
      gameUid: "1001369694001203",
      gameUserName: "Maverick",
      targetAshedMemberId: "member-1",
      claimConflictReason: "name_collision",
    });

    expect(id).toBe("help-race");
    expect(helpInsertCalls).toBe(1);
    expect(selectFn).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledTimes(2);
  });
});
