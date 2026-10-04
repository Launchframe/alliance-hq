import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: mocks.getDb,
}));

import * as schema from "@/lib/db/schema";
import type { AllianceMember, VideoJob } from "@/lib/db/schema";
import {
  commitFrontlineReview,
  FrontlineReviewError,
  validateFrontlineReview,
  type FrontlineSubmitBody,
} from "@/lib/video/frontline-results.server";

type DbState = {
  videoJobs?: unknown[];
  alliances?: unknown[];
  parseSessions?: unknown[];
  hqEvents?: unknown[];
  hqEventBoards?: unknown[];
  hqEventEvidenceBatches?: unknown[];
  hqEventObservations?: unknown[];
  hqEventMemberResults?: unknown[];
  hqEventSyncItems?: unknown[];
  parsedRows?: unknown[];
  allianceMembers?: unknown[];
  hqEventMembers?: unknown[];
};

function tableRows(table: unknown, state: DbState): unknown[] {
  if (table === schema.videoJobs) return state.videoJobs ?? [];
  if (table === schema.alliances) return state.alliances ?? [];
  if (table === schema.parseSessions) return state.parseSessions ?? [];
  if (table === schema.hqEvents) return state.hqEvents ?? [];
  if (table === schema.hqEventBoards) return state.hqEventBoards ?? [];
  if (table === schema.hqEventEvidenceBatches)
    return state.hqEventEvidenceBatches ?? [];
  if (table === schema.hqEventObservations)
    return state.hqEventObservations ?? [];
  if (table === schema.hqEventMemberResults)
    return state.hqEventMemberResults ?? [];
  if (table === schema.hqEventSyncItems) return state.hqEventSyncItems ?? [];
  if (table === schema.parsedRows) return state.parsedRows ?? [];
  if (table === schema.allianceMembers) return state.allianceMembers ?? [];
  if (table === schema.hqEventMembers) return state.hqEventMembers ?? [];
  return [];
}

function thenableRows(rows: unknown[]) {
  const result = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: (n: number) => Promise<unknown[]> & { for: () => Promise<unknown[]> };
    for: () => Promise<unknown[]>;
    orderBy: () => typeof result;
  };
  result.limit = (n: number) => {
    const limited = Promise.resolve(rows.slice(0, n)) as Promise<unknown[]> & {
      for: () => Promise<unknown[]>;
    };
    limited.for = () => Promise.resolve(rows.slice(0, n));
    return limited;
  };
  result.for = () => Promise.resolve(rows);
  result.orderBy = () => result;
  return result;
}

type MockTx = {
  select: () => {
    from: (table: unknown) => {
      where: () => ReturnType<typeof thenableRows>;
    };
  };
  update: (table: unknown) => {
    set: (values: unknown) => { where: () => Promise<void> };
  };
  insert: (table: unknown) => {
    values: (values: unknown) => Promise<void>;
  };
  delete: (table: unknown) => { where: () => Promise<void> };
};

function makeDb(state: DbState) {
  const calls = {
    selects: [] as Array<{ table: unknown }>,
    updates: [] as Array<{ table: unknown; set: unknown }>,
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    deletes: [] as Array<{ table: unknown }>,
  };
  const tx: MockTx = {
    select: () => ({
      from: (table: unknown) => {
        calls.selects.push({ table });
        return {
          where: () => thenableRows(tableRows(table, state)),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        calls.updates.push({ table, set: values });
        return { where: () => Promise.resolve() };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        calls.inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        calls.deletes.push({ table });
        return Promise.resolve();
      },
    }),
  };
  const db = {
    ...tx,
    transaction: (cb: (tx: MockTx) => unknown) => cb(tx),
  };
  return { db, calls };
}

const job = {
  id: "job-1",
  allianceId: "al-1",
  scoreTarget: "frontline-breakthrough",
  parseSessionId: "ps-1",
  hqEventId: "ev-1",
  status: "review",
  reviewOpenedAt: null,
} as unknown as VideoJob;

const parseSession = {
  id: "ps-1",
  jobId: "job-1",
  allianceId: "al-1",
  scoreTarget: "frontline-breakthrough",
};

const event = {
  id: "ev-1",
  allianceId: "al-1",
  scoreTarget: "frontline-breakthrough",
};

const member = (id: string, name: string) =>
  ({ ashedMemberId: id, currentName: name, allianceId: "al-1", status: "active" }) as unknown as AllianceMember;

const baseState = (): DbState => ({
  alliances: [{ id: "al-1" }],
  parseSessions: [parseSession],
  hqEvents: [event],
  parsedRows: [
    { id: "r1", parseSessionId: "ps-1", memberId: null, memberName: "Alpha", score: "100", rank: 1, frontlineStage: 5, manuallyAdded: 0 },
    { id: "r2", parseSessionId: "ps-1", memberId: null, memberName: "Beta", score: "200", rank: 2, frontlineStage: 4, manuallyAdded: 0 },
  ],
  allianceMembers: [member("m1", "Alpha"), member("m2", "Beta")],
});

const goodBody = (): FrontlineSubmitBody => ({
  hqEventId: "ev-1",
  recordedDate: "2025-06-15",
  rows: [
    { id: "r1", memberId: "m1", score: "100", rank: 1, frontlineStage: 5 },
    { id: "r2", memberId: "m2", score: "x200", rank: 2, frontlineStage: 4 },
  ],
});

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  try {
    await promise;
    expect.unreachable(`expected FrontlineReviewError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FrontlineReviewError);
    expect((error as FrontlineReviewError).code).toBe(code);
    if (status != null) expect((error as FrontlineReviewError).status).toBe(status);
  }
}

describe("validateFrontlineReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { db } = makeDb(baseState());
    mocks.getDb.mockReturnValue(db);
  });

  it("rejects a malformed rows array", async () => {
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: { rows: null as never } }),
      "frontlineInvalidRows",
    );
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: { rows: [{ id: 7 }] as never } }),
      "frontlineInvalidRows",
    );
  });

  it("rejects more than 2000 rows and duplicate row ids", async () => {
    const many = { rows: Array.from({ length: 2001 }, (_, i) => ({ id: `r${i}` })) };
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: many }),
      "frontlineInvalidRows",
    );
    const dup = goodBody();
    dup.rows[1] = { ...dup.rows[1], id: "r1" };
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: dup }),
      "frontlineInvalidRows",
    );
  });

  it("rejects non-boolean deleted flags after numeric normalization", async () => {
    const body = goodBody();
    (body.rows[0] as { deleted?: unknown }).deleted = "yes";
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body }),
      "frontlineInvalidRows",
    );
    const numeric = goodBody();
    (numeric.rows[0] as { deleted?: unknown }).deleted = 1;
    const validated = await validateFrontlineReview({ job, allianceId: "al-1", body: numeric });
    expect(validated.rows.find((row) => row.id === "r1")?.deleted).toBe(true);
  });

  it("rejects when the parse session is missing or bound to another job/target", async () => {
    const noSession = { ...job, parseSessionId: null } as unknown as VideoJob;
    await expectCode(
      validateFrontlineReview({ job: noSession, allianceId: "al-1", body: goodBody() }),
      "frontlineInvalidRows",
    );

    const { db } = makeDb({
      ...baseState(),
      parseSessions: [{ ...parseSession, scoreTarget: "vs-performance" }],
    });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: goodBody() }),
      "frontlineInvalidRows",
    );
  });

  it("rejects impossible recorded dates", async () => {
    const body = goodBody();
    body.recordedDate = "2025-02-30";
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body }),
      "frontlineInvalidEvent",
    );
    body.recordedDate = "15/06/2025";
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body }),
      "frontlineInvalidEvent",
    );
  });

  it("rejects a missing, foreign-alliance, or wrong-target event", async () => {
    for (const badEvent of [
      { ...event, allianceId: "other" },
      { ...event, scoreTarget: "vs-performance" },
    ]) {
      const { db } = makeDb({ ...baseState(), hqEvents: [badEvent] });
      mocks.getDb.mockReturnValue(db);
      await expectCode(
        validateFrontlineReview({ job, allianceId: "al-1", body: goodBody() }),
        "frontlineInvalidEvent",
      );
    }
    const { db } = makeDb({ ...baseState(), hqEvents: [] });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body: goodBody() }),
      "frontlineInvalidEvent",
    );
  });

  it("rejects row ids outside the job parse session", async () => {
    const body = goodBody();
    body.rows[0] = { ...body.rows[0], id: "foreign-row" };
    await expectCode(
      validateFrontlineReview({ job, allianceId: "al-1", body }),
      "frontlineInvalidRows",
    );
  });

  it("rejects unmatched or duplicate members with field issues", async () => {
    const body = goodBody();
    body.rows[0] = { ...body.rows[0], memberId: "not-a-member" };
    body.rows[1] = { ...body.rows[1], memberId: "m2" };
    try {
      await validateFrontlineReview({ job, allianceId: "al-1", body });
      expect.unreachable("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FrontlineReviewError);
      const err = error as FrontlineReviewError;
      expect(err.code).toBe("frontlineInvalidRows");
      expect(err.issues).toEqual([{ id: "r1", fields: ["member"] }]);
    }

    const dupMember = goodBody();
    dupMember.rows[1] = { ...dupMember.rows[1], memberId: "m1" };
    try {
      await validateFrontlineReview({ job, allianceId: "al-1", body: dupMember });
      expect.unreachable("expected rejection");
    } catch (error) {
      const err = error as FrontlineReviewError;
      expect(err.issues).toEqual([{ id: "r2", fields: ["member"] }]);
    }
  });

  it("rejects invalid stage, score, and rank fields", async () => {
    const body = goodBody();
    body.rows[0] = { ...body.rows[0], frontlineStage: 0, score: "abc", rank: -1 };
    try {
      await validateFrontlineReview({ job, allianceId: "al-1", body });
      expect.unreachable("expected rejection");
    } catch (error) {
      const err = error as FrontlineReviewError;
      expect(err.issues).toEqual([{ id: "r1", fields: ["stage", "score", "rank"] }]);
    }
  });

  it("returns normalized rows including deleted rows untouched by field checks", async () => {
    const { db } = makeDb({
      ...baseState(),
      parsedRows: [
        ...baseState().parsedRows!,
        { id: "r3", parseSessionId: "ps-1", memberId: "m9", memberName: "Ghost", score: "1", rank: 9, frontlineStage: 1, manuallyAdded: 0 },
      ],
    });
    mocks.getDb.mockReturnValue(db);
    const body = goodBody();
    body.rows.push({ id: "r3", deleted: true });
    const validated = await validateFrontlineReview({ job, allianceId: "al-1", body });
    expect(validated.eventId).toBe("ev-1");
    expect(validated.recordedDate).toBe("2025-06-15");
    const r2 = validated.rows.find((row) => row.id === "r2");
    expect(r2?.memberName).toBe("Beta");
    expect(r2?.score).toBe("200");
    const r3 = validated.rows.find((row) => row.id === "r3");
    expect(r3?.deleted).toBe(true);
  });
});

describe("commitFrontlineReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a job whose status is not submit-ready", async () => {
    const { db } = makeDb({ ...baseState(), videoJobs: [{ ...job, status: "processing" }] });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      commitFrontlineReview({ job, allianceId: "al-1", sessionId: "s1", hqUserId: "u1", body: goodBody() }),
      "frontlineSaveFailed",
      409,
    );
  });

  it("saves active rows, marks the job complete, and audits in one transaction", async () => {
    const { db, calls } = makeDb({ ...baseState(), videoJobs: [{ ...job }] });
    mocks.getDb.mockReturnValue(db);

    const body = goodBody();
    body.rows[0] = { ...body.rows[0], memberName: "Spoofed Name" };
    const result = await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body,
    });
    expect(result).toEqual({ submitted: 2 });

    const rowUpdate = calls.updates.find(
      (update) => update.table === schema.parsedRows,
    );
    expect((rowUpdate!.set as { memberName: string }).memberName).toBe("Alpha");

    const memberInserts = calls.inserts.filter((insert) => insert.table === schema.hqEventMembers);
    expect(memberInserts).toHaveLength(2);
    const metadata = (memberInserts[0]!.values as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.frontlineStage).toBe(5);
    expect(metadata.score).toBe(100);
    expect(metadata.sourceJobId).toBe("job-1");
    expect(metadata.sourceRowId).toBe("r1");

    const jobUpdates = calls.updates.filter((update) => update.table === schema.videoJobs);
    expect((jobUpdates[0]!.set as { status: string }).status).toBe("complete");

    const audits = calls.inserts.filter((insert) => insert.table === schema.auditLog);
    expect(audits).toHaveLength(1);
    const audit = audits[0]!.values as { action: string; severity: string };
    expect(audit.action).toBe("frontline.results_saved");
    expect(audit.severity).toBe("routine");
  });

  it("commits evidence ledger rows in the same transaction when the event has a board", async () => {
    const { db, calls } = makeDb({
      ...baseState(),
      videoJobs: [{ ...job }],
      hqEventBoards: [
        {
          id: "bd-1",
          allianceId: "al-1",
          hqEventId: "ev-1",
          boardKey: "main",
          evidenceVersion: 1,
        },
      ],
      // Prior committed observations so the merge recompute produces member
      // results + desired sync items (the mock can't see same-tx inserts).
      hqEventObservations: [
        {
          id: "obs-1",
          allianceId: "al-1",
          hqEventId: "ev-1",
          boardId: "bd-1",
          memberId: "m1",
          memberName: "Alpha",
          evidenceKind: "leaderboard",
          realScore: "90",
          retracted: 0,
          createdAt: new Date("2025-06-01"),
        },
      ],
    });
    mocks.getDb.mockReturnValue(db);

    await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body: goodBody(),
    });

    const batchInserts = calls.inserts.filter(
      (insert) => insert.table === schema.hqEventEvidenceBatches,
    );
    expect(batchInserts).toHaveLength(1);
    const observationInserts = calls.inserts.filter(
      (insert) => insert.table === schema.hqEventObservations,
    );
    expect(observationInserts).toHaveLength(2);
    const obs = observationInserts[0]!.values as {
      evidenceKind: string;
      realScore: string | null;
      stage: number | null;
      memberId: string;
    };
    expect(obs.evidenceKind).toBe("leaderboard");
    expect(obs.realScore).toBe("100");
    expect(obs.stage).toBe(5);
    const resultInserts = calls.inserts.filter(
      (insert) => insert.table === schema.hqEventMemberResults,
    );
    expect(resultInserts.length).toBeGreaterThan(0);
    const syncInserts = calls.inserts.filter(
      (insert) => insert.table === schema.hqEventSyncItems,
    );
    expect(syncInserts.length).toBeGreaterThan(0);
  });

  it("uses update severity and does not touch other-owned event members on resave", async () => {
    const foreignRecord = {
      id: "hem-foreign",
      hqEventId: "ev-1",
      memberId: "m9",
      metadata: { sourceJobId: "job-other", sourceRowId: "x" },
    };
    const staleRecord = {
      id: "hem-stale",
      hqEventId: "ev-1",
      memberId: "m9",
      metadata: { sourceJobId: "job-1", sourceRowId: "r1" },
    };
    const { db, calls } = makeDb({
      ...baseState(),
      videoJobs: [{ ...job, status: "complete" }],
      hqEventMembers: [foreignRecord, staleRecord],
    });
    mocks.getDb.mockReturnValue(db);

    const result = await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body: goodBody(),
    });
    expect(result.submitted).toBe(2);

    const deletes = calls.deletes.filter((del) => del.table === schema.hqEventMembers);
    expect(deletes).toHaveLength(1);
    const audits = calls.inserts.filter((insert) => insert.table === schema.auditLog);
    expect((audits[0]!.values as { severity: string }).severity).toBe("update");
  });

  it("keeps same-job results whose source rows are omitted from the body", async () => {
    const omittedRecord = {
      id: "hem-omitted",
      hqEventId: "ev-1",
      memberId: "m9",
      metadata: { sourceJobId: "job-1", sourceRowId: "r-omitted" },
    };
    const { db, calls } = makeDb({
      ...baseState(),
      videoJobs: [{ ...job, status: "complete" }],
      hqEventMembers: [omittedRecord],
    });
    mocks.getDb.mockReturnValue(db);

    await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body: goodBody(),
    });
    expect(
      calls.deletes.filter((del) => del.table === schema.hqEventMembers),
    ).toHaveLength(0);
  });

  it("ignores supplied fields on deleted rows and rewrites persisted originals", async () => {
    const { db, calls } = makeDb({ ...baseState(), videoJobs: [{ ...job, status: "complete" }] });
    mocks.getDb.mockReturnValue(db);

    const body = goodBody();
    body.rows[0] = {
      id: "r1",
      deleted: true,
      memberId: "evil-member",
      memberName: "Injected",
      score: "not-a-score",
      rank: "bogus" as never,
      frontlineStage: { bad: true } as never,
    };
    const result = await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body,
    });
    expect(result.submitted).toBe(1);

    const rowUpdate = calls.updates.find((update) => update.table === schema.parsedRows);
    expect(rowUpdate?.set).toMatchObject({
      memberId: null,
      memberName: "Alpha",
      score: "100",
      rank: 1,
      frontlineStage: 5,
      deleted: 1,
    });
  });

  it("rejects an empty body and a delete-only first save", async () => {
    const { db } = makeDb({ ...baseState(), videoJobs: [{ ...job }] });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      commitFrontlineReview({
        job,
        allianceId: "al-1",
        sessionId: "s1",
        hqUserId: "u1",
        body: { hqEventId: "ev-1", recordedDate: "2025-06-15", rows: [] },
      }),
      "frontlineInvalidRows",
    );

    const deleteOnly = {
      hqEventId: "ev-1",
      recordedDate: "2025-06-15",
      rows: [{ id: "r1", deleted: true }],
    };
    await expectCode(
      commitFrontlineReview({ job, allianceId: "al-1", sessionId: "s1", hqUserId: "u1", body: deleteOnly }),
      "frontlineInvalidRows",
    );
  });

  it("rejects with 409 when the stored parse session no longer matches the snapshot", async () => {
    const { db } = makeDb({ ...baseState(), videoJobs: [{ ...job, parseSessionId: "ps-2" }] });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      commitFrontlineReview({ job, allianceId: "al-1", sessionId: "s1", hqUserId: "u1", body: goodBody() }),
      "frontlineSaveFailed",
      409,
    );
  });

  it("allows a delete-only resave on a completed job", async () => {
    const { db } = makeDb({ ...baseState(), videoJobs: [{ ...job, status: "complete" }] });
    mocks.getDb.mockReturnValue(db);
    const result = await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body: {
        hqEventId: "ev-1",
        recordedDate: "2025-06-15",
        rows: [{ id: "r1", deleted: true }, { id: "r2", deleted: true }],
      },
    });
    expect(result.submitted).toBe(0);
  });

  it("locks job, session, events, and parsed rows before validating", async () => {
    const { db, calls } = makeDb({ ...baseState(), videoJobs: [{ ...job }] });
    mocks.getDb.mockReturnValue(db);
    await commitFrontlineReview({
      job,
      allianceId: "al-1",
      sessionId: "s1",
      hqUserId: "u1",
      body: goodBody(),
    });
    expect(calls.selects.slice(0, 5).map((select) => select.table)).toEqual([
      schema.videoJobs,
      schema.alliances,
      schema.hqEvents,
      schema.parseSessions,
      schema.parsedRows,
    ]);
  });

  it("rejects a wrong-target event after locks without any mutation", async () => {
    const { db, calls } = makeDb({
      ...baseState(),
      videoJobs: [{ ...job }],
      hqEvents: [{ ...event, scoreTarget: "vs-performance" }],
    });
    mocks.getDb.mockReturnValue(db);
    await expectCode(
      commitFrontlineReview({ job, allianceId: "al-1", sessionId: "s1", hqUserId: "u1", body: goodBody() }),
      "frontlineInvalidEvent",
    );
    expect(calls.selects.slice(0, 5).map((select) => select.table)).toEqual([
      schema.videoJobs,
      schema.alliances,
      schema.hqEvents,
      schema.parseSessions,
      schema.parsedRows,
    ]);
    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
  });
});
