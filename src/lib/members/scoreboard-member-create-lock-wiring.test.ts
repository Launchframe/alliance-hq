import { beforeEach, describe, expect, it, vi } from "vitest";

const withScoreboardMemberCreateLock = vi.hoisted(() =>
  vi.fn(async (_key: unknown, run: () => Promise<unknown>) => run()),
);
const getAshedAllianceIdIfLinked = vi.hoisted(() => vi.fn());
const loadAshedConnectionForAllianceCapability = vi.hoisted(() => vi.fn());
const base44EntityPost = vi.hoisted(() => vi.fn());
const base44ListMembers = vi.hoisted(() => vi.fn());
const syncCommanderFromAllianceMember = vi.hoisted(() => vi.fn());
const nativeRosterAshedAllianceId = vi.hoisted(() =>
  vi.fn((id: string) => `native:${id}`),
);

const selectQueue: unknown[][] = [];
const nextRows = () => selectQueue.shift() ?? [];

function buildSelectChain() {
  let consumed: unknown[] | null = null;
  const consume = () => {
    if (consumed == null) consumed = nextRows();
    return consumed;
  };
  const forUpdate = vi.fn(async () => consume());
  const chain: {
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    for: typeof forUpdate;
    then: Promise<unknown[]>["then"];
  } = {
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    for: forUpdate,
    then: (onfulfilled, onrejected) =>
      Promise.resolve(consume()).then(onfulfilled, onrejected),
  };
  return chain;
}

const where = vi.fn(() => buildSelectChain());
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));
const insertValues = vi.fn(async () => undefined);
const insert = vi.fn(() => ({ values: insertValues }));
const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
const update = vi.fn(() => ({ set: updateSet }));
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({ select, insert, update }),
);

vi.mock("@/lib/members/scoreboard-member-create-lock.server", () => ({
  withScoreboardMemberCreateLock,
}));
vi.mock("@/lib/alliance/ashed-write-guard", () => ({
  getAshedAllianceIdIfLinked,
}));
vi.mock("@/lib/ashed/load-ashed-connection.server", () => ({
  loadAshedConnectionForAllianceCapability,
}));
vi.mock("@/lib/base44/fetch", () => ({
  base44EntityPost,
  base44ListMembers,
}));
vi.mock("@/lib/members/commander-identity.server", () => ({
  syncCommanderFromAllianceMember,
}));
const syncMemberNameToAshed = vi.hoisted(() => vi.fn());
vi.mock("@/lib/members/member-name-sync.server", () => ({
  syncMemberNameToAshed,
}));
vi.mock("@/lib/native-alliance/provision", () => ({
  nativeRosterAshedAllianceId,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select, insert, update, transaction }),
  schema: {
    parsedRows: {
      id: "id",
      ocrName: "ocr_name",
      memberId: "member_id",
      memberName: "member_name",
      matchMethod: "match_method",
      deleted: "deleted",
      parseSessionId: "parse_session_id",
      matchConfidence: "match_confidence",
      edited: "edited",
      updatedAt: "updated_at",
    },
    allianceMembers: {
      id: "id",
      allianceId: "alliance_id",
      ashedMemberId: "ashed_member_id",
      ashedAllianceId: "ashed_alliance_id",
      currentName: "current_name",
      previousNamesJson: "previous_names_json",
      status: "status",
      syncedAt: "synced_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
}));

import { createScoreboardMembersFromReview } from "./scoreboard-member-actions.server";

describe("createScoreboardMembersFromReview dedicated lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    withScoreboardMemberCreateLock.mockImplementation(
      async (_key: unknown, run: () => Promise<unknown>) => run(),
    );
    getAshedAllianceIdIfLinked.mockResolvedValue("ashed-alliance-1");
    loadAshedConnectionForAllianceCapability.mockResolvedValue({
      token: "t",
    });
    base44ListMembers.mockResolvedValue([]);
    base44EntityPost.mockResolvedValue({ id: "ashed-member-new" });
    syncCommanderFromAllianceMember.mockResolvedValue(undefined);
    transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ select, insert, update }),
    );
  });

  it("holds withScoreboardMemberCreateLock across Ashed create for the OCR name", async () => {
    const order: string[] = [];
    withScoreboardMemberCreateLock.mockImplementation(
      async (_key: unknown, run: () => Promise<unknown>) => {
        order.push("lock");
        try {
          return await run();
        } finally {
          order.push("unlock");
        }
      },
    );
    base44EntityPost.mockImplementation(async () => {
      order.push("ashed-create");
      return { id: "ashed-member-new" };
    });
    transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        if (order.includes("ashed-create")) {
          order.push("hq-tx");
        }
        return fn({ select, insert, update });
      },
    );

    selectQueue.push([
      {
        id: "row-1",
        ocrName: "Bat Pig",
        memberId: null,
        memberName: null,
        matchMethod: null,
        deleted: 0,
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([
      {
        id: "row-1",
        memberId: null,
        memberName: null,
        matchMethod: null,
      },
    ]);

    await createScoreboardMembersFromReview({
      sessionId: "sess-1",
      allianceId: "alliance-1",
      parseSessionId: "parse-1",
      rows: [{ id: "row-1", confirmedName: "Bat Pig" }],
    });

    expect(withScoreboardMemberCreateLock).toHaveBeenCalledWith(
      { allianceId: "alliance-1", normalizedName: "bat pig" },
      expect.any(Function),
    );
    expect(order).toEqual(["lock", "ashed-create", "hq-tx", "unlock"]);
    expect(base44EntityPost).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalled();
  });

  it("binds an Ashed near-match with nameOverride and dual-writes previous_names", async () => {
    base44ListMembers.mockResolvedValue([
      { id: "ashed-existing", current_name: "BatPig" },
    ]);

    selectQueue.push([
      {
        id: "row-1",
        ocrName: "Bat Pig",
        memberId: null,
        memberName: null,
        matchMethod: null,
        deleted: 0,
      },
    ]);
    // findHqMemberIdByAshedId (outside TX)
    selectQueue.push([]);
    // findHqMemberIdByAshedId (inside TX)
    selectQueue.push([]);
    // fresh parsed row lock
    selectQueue.push([
      {
        id: "row-1",
        memberId: null,
        memberName: null,
        matchMethod: null,
      },
    ]);

    const result = await createScoreboardMembersFromReview({
      sessionId: "sess-1",
      allianceId: "alliance-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-1",
          confirmedName: "Bat Pig",
          bindAshedMemberId: "ashed-existing",
          nameOverride: true,
        },
      ],
    });

    expect(base44EntityPost).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ashedMemberId: "ashed-existing",
        currentName: "Bat Pig",
        previousNamesJson: ["BatPig"],
      }),
    );
    expect(syncMemberNameToAshed).toHaveBeenCalledWith(
      { token: "t" },
      "ashed-existing",
      "Bat Pig",
      ["BatPig"],
    );
    expect(result.members[0]).toMatchObject({
      id: "ashed-existing",
      current_name: "Bat Pig",
      previous_names: ["BatPig"],
    });
  });
});
