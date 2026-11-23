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

import { AshedNotConnectedError } from "@/lib/video/errors";

import {
  applyScoreboardMemberNamesFromReview,
  createScoreboardMembersFromReview,
  ScoreboardMemberActionError,
  scoreboardMemberActionFailure,
} from "./scoreboard-member-actions.server";

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
    // alliance member lookup inside the bind transaction
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
    expect(syncMemberNameToAshed).toHaveBeenCalledTimes(1);
  });

  it("keeps existing Ashed previous names when overriding", async () => {
    base44ListMembers.mockResolvedValue([
      {
        id: "ashed-existing",
        current_name: "BatPig",
        previous_names: ["Piglet"],
      },
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
      rows: [
        {
          id: "row-1",
          confirmedName: "Bat Pig",
          bindAshedMemberId: "ashed-existing",
          nameOverride: true,
        },
      ],
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        previousNamesJson: ["Piglet", "BatPig"],
      }),
    );
    expect(syncMemberNameToAshed).toHaveBeenCalledWith(
      { token: "t" },
      "ashed-existing",
      "Bat Pig",
      ["Piglet", "BatPig"],
    );
  });

  it("copies Ashed history and does not rename when using the suggested name", async () => {
    base44ListMembers.mockResolvedValue([
      {
        id: "ashed-existing",
        current_name: "BatPig",
        previous_names: ["Piglet"],
      },
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
      rows: [
        {
          id: "row-1",
          confirmedName: "Bat Pig",
          bindAshedMemberId: "ashed-existing",
          nameOverride: false,
        },
      ],
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        currentName: "BatPig",
        previousNamesJson: ["Piglet"],
      }),
    );
    expect(syncMemberNameToAshed).not.toHaveBeenCalled();
  });

  it("keeps the HQ name when the suggested member is already on the roster", async () => {
    base44ListMembers.mockResolvedValue([
      {
        id: "ashed-existing",
        current_name: "BatPig",
        previous_names: ["Piglet"],
      },
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
    selectQueue.push([
      {
        id: "hq-1",
        ashedMemberId: "ashed-existing",
        currentName: "Alice",
        previousNamesJson: ["Allie"],
      },
    ]);
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
          nameOverride: false,
        },
      ],
    });

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentName: expect.any(String) }),
    );
    expect(syncMemberNameToAshed).not.toHaveBeenCalled();
    expect(result.rows[0]).toMatchObject({
      memberId: "ashed-existing",
      memberName: "Alice",
    });
  });

  it("retries the Ashed rename when HQ already has the override name", async () => {
    base44ListMembers.mockResolvedValue([
      { id: "ashed-existing", current_name: "BatPig", previous_names: [] },
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
    selectQueue.push([
      {
        id: "hq-1",
        ashedMemberId: "ashed-existing",
        currentName: "Bat Pig",
        previousNamesJson: ["BatPig"],
      },
    ]);
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
      rows: [
        {
          id: "row-1",
          confirmedName: "Bat Pig",
          bindAshedMemberId: "ashed-existing",
          nameOverride: true,
        },
      ],
    });

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentName: "Bat Pig" }),
    );
    expect(syncMemberNameToAshed).toHaveBeenCalledTimes(1);
    expect(syncMemberNameToAshed).toHaveBeenCalledWith(
      { token: "t" },
      "ashed-existing",
      "Bat Pig",
      ["BatPig"],
    );
  });

  it("skips the Ashed rename when HQ and Ashed already match", async () => {
    base44ListMembers.mockResolvedValue([
      {
        id: "ashed-existing",
        current_name: "Bat Pig",
        previous_names: ["BatPig"],
      },
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
    selectQueue.push([
      {
        id: "hq-1",
        ashedMemberId: "ashed-existing",
        currentName: "Bat Pig",
        previousNamesJson: ["BatPig"],
      },
    ]);
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
      rows: [
        {
          id: "row-1",
          confirmedName: "Bat Pig",
          bindAshedMemberId: "ashed-existing",
          nameOverride: true,
        },
      ],
    });

    expect(syncMemberNameToAshed).not.toHaveBeenCalled();
  });

  it("does not bind a former Ashed member with the same name", async () => {
    base44ListMembers.mockResolvedValue([
      { id: "former-1", current_name: "Bat Pig", status: "former" },
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

    expect(base44EntityPost).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ ashedMemberId: "ashed-member-new" }),
    );
  });

  it("rejects two confirmed names for the same Ashed bind before writing", async () => {
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
      {
        id: "row-2",
        ocrName: "Batty",
        memberId: null,
        memberName: null,
        matchMethod: null,
        deleted: 0,
      },
    ]);

    await expect(
      createScoreboardMembersFromReview({
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
          {
            id: "row-2",
            confirmedName: "Batty",
            bindAshedMemberId: "ashed-existing",
            nameOverride: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ScoreboardMemberActionError);
    expect(insertValues).not.toHaveBeenCalled();
    expect(withScoreboardMemberCreateLock).not.toHaveBeenCalled();
  });

  it("rejects a rename that would store two names on one member", async () => {
    selectQueue.push([
      {
        id: "row-1",
        ocrName: "Bat Pig",
        memberId: "m1",
        memberName: "Old",
        matchMethod: "manual",
        deleted: 0,
      },
      {
        id: "row-2",
        ocrName: "Batty",
        memberId: "m1",
        memberName: "Old",
        matchMethod: "manual",
        deleted: 0,
      },
    ]);

    await expect(
      applyScoreboardMemberNamesFromReview({
        sessionId: "sess-1",
        allianceId: "alliance-1",
        parseSessionId: "parse-1",
        rows: [
          { id: "row-1", confirmedName: "Bat Pig" },
          { id: "row-2", confirmedName: "Batty" },
        ],
      }),
    ).rejects.toBeInstanceOf(ScoreboardMemberActionError);
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe("scoreboardMemberActionFailure", () => {
  it("maps name conflicts and missing Ashed credentials", () => {
    expect(
      scoreboardMemberActionFailure(new Error("other"), "job-1", {
        nameConflict: "conflict",
      }),
    ).toBeNull();
    expect(
      scoreboardMemberActionFailure(new ScoreboardMemberActionError(), "job-1", {
        nameConflict: "conflict",
      }),
    ).toEqual({
      status: 409,
      body: { error: "conflict", code: "scoreboard_member_name_conflict" },
    });
    expect(
      scoreboardMemberActionFailure(
        new AshedNotConnectedError("Connect Ashed"),
        "job-9",
        { nameConflict: "conflict" },
      ),
    ).toEqual({
      status: 409,
      body: {
        error: "Connect Ashed",
        code: "ashed_not_connected",
        connectUrl: "/connect?next=%2Ftools%2Fvideo-upload%2Fjob-9%2Freview",
      },
    });
  });
});
