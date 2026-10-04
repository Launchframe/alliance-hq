import { afterAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { JSONValue } from "postgres";

import {
  getE2eSql,
  closeE2eSql,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createAllianceMembership,
  createAllianceRosterMember,
} from "../../../e2e/fixtures/db";
import { getDb, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { submitEventEvidenceFromVideoJob } from "@/lib/hq-events/evidence-submit.server";
import {
  WARZONE_LEADERBOARD_TARGET,
  WARZONE_POLL_TARGET,
} from "@/lib/video/warzone-evidence.shared";
import type { Session } from "@/lib/db/schema";

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: vi.fn().mockRejectedValue(new Error("unexpected_external_request")),
}));

let usedDatabase = false;

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup(opts: { roleName?: "officer" | "viewer" } = {}) {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (
    url !==
    (process.env.E2E_DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim())
  ) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `ES${nanoid(5)}`,
    name: "Evidence Submit Test",
  });
  const officer = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  await createAllianceMembership(sql, {
    hqUserId: officer.hqUserId,
    allianceId: alliance.allianceId,
    roleName: opts.roleName ?? "officer",
    source: "manual",
  });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${officer.sessionId}`;
  // scores:write is an Ashed-catalog permission; seed the grant deterministically.
  await sql`INSERT INTO permissions (id, description) VALUES ('scores:write', 'test') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role-officer', 'scores:write') ON CONFLICT DO NOTHING`;

  const memberId = `m-${nanoid(8)}`;
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Roster One",
    ashedMemberId: memberId,
  });

  const now = new Date();
  const seriesId = `ser-${nanoid(10)}`;
  const eventId = `ev-${nanoid(10)}`;
  const boardId = `bd-${nanoid(10)}`;
  await sql`INSERT INTO hq_event_series (id, alliance_id, score_target, name, event_family, created_at, updated_at)
    VALUES (${seriesId}, ${alliance.allianceId}, 'warzone-duel', 'WZ', 'warzone-duel', ${now}, ${now})`;
  await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
    VALUES (${eventId}, ${alliance.allianceId}, ${seriesId}, 'warzone-duel', 'WZ Event', 'warzone-duel', 1, '2099-01-01', 'active', ${now}, ${now})`;
  await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
    VALUES (${boardId}, ${alliance.allianceId}, ${eventId}, 'main', 'Main', 1, ${now}, ${now})`;

  const [session] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, officer.sessionId))
    .limit(1);

  return {
    sql,
    allianceId: alliance.allianceId,
    session: session! as Session,
    hqUserId: officer.hqUserId,
    sessionId: officer.sessionId,
    memberId,
    eventId,
    boardId,
  };
}

async function createMediaJob(
  f: Fixture,
  opts: {
    ingestMethod?: "image" | "video";
    passRole?: string;
    eventContext?: unknown;
    groupSelectedJobId?: string | null;
    scoreTarget?: string;
    parseRows?: {
      ocrName: string;
      memberId?: string | null;
      memberName?: string | null;
      score?: string | null;
      rank?: number | null;
      eventEvidence?: unknown;
    }[];
  } = {},
) {
  const sql = f.sql;
  const now = new Date();
  const groupId = `grp-${nanoid(10)}`;
  const jobId = `job-${nanoid(10)}`;
  const parseSessionId = `ps-${nanoid(10)}`;
  const eventContext =
    opts.eventContext === undefined
      ? { eventId: f.eventId, boardId: f.boardId }
      : opts.eventContext;

  await sql`INSERT INTO video_upload_groups (id, session_id, alliance_id, file_name, score_target, event_context, selected_job_id, created_at, updated_at)
    VALUES (${groupId}, ${f.sessionId}, ${f.allianceId}, 'frame.png', ${opts.scoreTarget ?? WARZONE_LEADERBOARD_TARGET}, ${sql.json(eventContext as JSONValue)}, ${opts.groupSelectedJobId === undefined ? jobId : opts.groupSelectedJobId}, ${now}, ${now})`;
  await sql`INSERT INTO video_jobs (id, session_id, hq_user_id, status, file_name, score_target, alliance_id, group_id, pass_key, pass_role, parse_session_id, ingest_method, event_context, created_at, updated_at)
    VALUES (${jobId}, ${f.sessionId}, ${f.hqUserId}, 'review', 'frame.png', ${opts.scoreTarget ?? WARZONE_LEADERBOARD_TARGET}, ${f.allianceId}, ${groupId}, 'primary', ${opts.passRole ?? "primary"}, ${parseSessionId}, ${opts.ingestMethod ?? "image"}, ${sql.json(eventContext as JSONValue)}, ${now}, ${now})`;
  await sql`INSERT INTO parse_sessions (id, job_id, session_id, score_target, alliance_id, status, created_at, updated_at)
    VALUES (${parseSessionId}, ${jobId}, ${f.sessionId}, ${opts.scoreTarget ?? WARZONE_LEADERBOARD_TARGET}, ${f.allianceId}, 'open', ${now}, ${now})`;

  const rowIds: string[] = [];
  for (const row of opts.parseRows ?? []) {
    const rowId = `row-${nanoid(10)}`;
    rowIds.push(rowId);
    await sql`INSERT INTO parsed_rows (id, parse_session_id, ocr_name, member_id, member_name, score, rank, event_evidence, created_at, updated_at)
      VALUES (${rowId}, ${parseSessionId}, ${row.ocrName}, ${row.memberId ?? null}, ${row.memberName ?? null}, ${row.score ?? null}, ${row.rank ?? null}, ${sql.json((row.eventEvidence ?? null) as JSONValue)}, ${now}, ${now})`;
  }

  return {
    groupId,
    jobId,
    parseSessionId,
    rowIds,
    job: {
      id: jobId,
      sessionId: f.sessionId,
      allianceId: f.allianceId,
      hqUserId: f.hqUserId,
      enqueuedByHqUserId: f.hqUserId,
      scoreTarget: opts.scoreTarget ?? WARZONE_LEADERBOARD_TARGET,
      category: null,
      status: "review",
      ingestMethod: opts.ingestMethod ?? "image",
      parseSessionId,
      groupId,
      passRole: opts.passRole ?? "primary",
      fileName: "frame.png",
      eventContext,
    },
  };
}

async function observationCount(f: Fixture) {
  const rows = await f.sql`SELECT COUNT(*)::int AS c FROM hq_event_observations WHERE alliance_id = ${f.allianceId}`;
  return rows[0]!.c as number;
}

async function jobStatus(f: Fixture, jobId: string) {
  const [row] = await f.sql`SELECT status FROM video_jobs WHERE id = ${jobId}`;
  return row!.status as string;
}

describe.skipIf(!process.env.EVENT_EVIDENCE_DB_TEST)("submitEventEvidenceFromVideoJob", () => {
  afterAll(async () => {
    if (usedDatabase) await closeE2eSql();
  });

  it("saves reviewed leaderboard rows and consumes the job", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      parseRows: [
        {
          ocrName: "Roster One",
          memberId: f.memberId,
          memberName: "Roster One",
          score: "12345",
          rank: 52,
          eventEvidence: { frameIndex: 0 },
        },
      ],
    });

    const { receipt, rowCount } = await submitEventEvidenceFromVideoJob({
      session: f.session,
      job: media.job,
      body: {
        requestId: `req-${nanoid(12)}`,
        rows: [
          {
            rowId: media.rowIds[0]!,
            memberId: f.memberId,
            memberName: "Roster One",
            kind: "leaderboard",
            realScore: "12345",
            observedRank: 52,
          },
        ],
      },
    });

    expect(rowCount).toBe(1);
    expect(receipt.replayed).toBe(false);
    expect(await observationCount(f)).toBe(1);
    expect(await jobStatus(f, media.jobId)).toBe("complete");
    const [ps] = await f.sql`SELECT status FROM parse_sessions WHERE id = ${media.parseSessionId}`;
    expect(ps!.status).toBe("submitted");
    const batches = await f.sql`SELECT id FROM data_upload_batches WHERE source_job_id = ${media.jobId}`;
    expect(batches).toHaveLength(1);
    const results = await f.sql`SELECT real_score, observed_rank FROM hq_event_member_results WHERE alliance_id = ${f.allianceId}`;
    expect(results).toHaveLength(1);
    expect(results[0]!.real_score).toBe("12345");
    expect(results[0]!.observed_rank).toBe(52);
  });

  it("replays the same requestId without duplicating rows", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      parseRows: [
        { ocrName: "Roster One", memberId: f.memberId, score: "100" },
      ],
    });
    const requestId = `req-${nanoid(12)}`;
    const body = {
      requestId,
      rows: [
        {
          rowId: media.rowIds[0]!,
          memberId: f.memberId,
          kind: "leaderboard" as const,
          realScore: "100",
        },
      ],
    };
    const first = await submitEventEvidenceFromVideoJob({ session: f.session, job: media.job, body });
    expect(first.receipt.replayed).toBe(false);
    const second = await submitEventEvidenceFromVideoJob({ session: f.session, job: { ...media.job, status: "complete" }, body });
    expect(second.receipt.replayed).toBe(true);
    expect(second.receipt.batchId).toBe(first.receipt.batchId);
    expect(await observationCount(f)).toBe(1);
  });

  it("rejects callers without scores:write (processor-only access cannot save)", async () => {
    const f = await setup({ roleName: "viewer" });
    const media = await createMediaJob(f, {
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "1" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: "1" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "permission_required", httpStatus: 403 });
    expect(await observationCount(f)).toBe(0);
  });

  it("rejects a stale selected pass when group selection moved", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      groupSelectedJobId: `job-${nanoid(10)}`,
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "1" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: "1" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "stale_selected_pass", httpStatus: 409 });
    expect(await jobStatus(f, media.jobId)).toBe("review");
  });

  it("rolls back atomically when the bound board belongs to another event", async () => {
    const f = await setup();
    const sql = f.sql;
    const now = new Date();
    const otherEventId = `ev-${nanoid(10)}`;
    const otherBoardId = `bd-${nanoid(10)}`;
    await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
      VALUES (${otherEventId}, ${f.allianceId}, NULL, 'warzone-duel', 'Other', 'warzone-duel', 1, '2099-01-02', 'active', ${now}, ${now})`;
    await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
      VALUES (${otherBoardId}, ${f.allianceId}, ${otherEventId}, 'main', 'Main', 1, ${now}, ${now})`;

    const media = await createMediaJob(f, {
      eventContext: { eventId: f.eventId, boardId: otherBoardId },
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "9" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: "9" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "board_not_found" });
    expect(await observationCount(f)).toBe(0);
    const results = await f.sql`SELECT COUNT(*)::int AS c FROM hq_event_member_results WHERE alliance_id = ${f.allianceId}`;
    expect(results[0]!.c).toBe(0);
    expect(await jobStatus(f, media.jobId)).toBe("review");
  });

  it("rejects event reassignment: context bound to another alliance's event", async () => {
    const f = await setup();
    const sql = f.sql;
    const other = await createNativeAlliance(sql, { tag: `OT${nanoid(5)}`, name: "Other" });
    const now = new Date();
    const foreignEventId = `ev-${nanoid(10)}`;
    const foreignBoardId = `bd-${nanoid(10)}`;
    await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
      VALUES (${foreignEventId}, ${other.allianceId}, NULL, 'warzone-duel', 'Foreign', 'warzone-duel', 1, '2099-01-03', 'active', ${now}, ${now})`;
    await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
      VALUES (${foreignBoardId}, ${other.allianceId}, ${foreignEventId}, 'main', 'Main', 1, ${now}, ${now})`;

    const media = await createMediaJob(f, {
      eventContext: { eventId: foreignEventId, boardId: foreignBoardId },
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "5" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: "5" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "event_not_found" });
    expect(await observationCount(f)).toBe(0);
  });

  it("rejects unmatched members and unmatched non-excluded rows", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      parseRows: [{ ocrName: "Ghost", memberId: null, memberName: null }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: null, kind: "leaderboard", realScore: "10" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "unmatched_member", httpStatus: 400 });
    // Excluding the same row lets the save proceed.
    const { rowCount } = await submitEventEvidenceFromVideoJob({
      session: f.session,
      job: media.job,
      body: {
        requestId: `req-${nanoid(12)}`,
        rows: [
          { rowId: media.rowIds[0]!, memberId: null, kind: "leaderboard", excluded: true },
        ],
      },
    });
    expect(rowCount).toBe(0);
    expect(await observationCount(f)).toBe(0);
  });

  it("blocks poll rows until options are confirmed and rejects unresolved options", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      scoreTarget: WARZONE_POLL_TARGET,
      parseRows: [
        { ocrName: "Roster One", memberId: f.memberId, eventEvidence: { frameIndex: 0 } },
      ],
    });
    const base = {
      requestId: `req-${nanoid(12)}`,
      rows: [
        { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "poll_yes" as const, pollOption: 1 as const },
      ],
    };
    await expect(
      submitEventEvidenceFromVideoJob({ session: f.session, job: media.job, body: base }),
    ).rejects.toMatchObject({ code: "poll_options_unconfirmed", httpStatus: 409 });

    const { rowCount } = await submitEventEvidenceFromVideoJob({
      session: f.session,
      job: media.job,
      body: { ...base, requestId: `req-${nanoid(12)}`, pollOptionsConfirmed: true },
    });
    expect(rowCount).toBe(1);
    const [obs] = await f.sql`SELECT evidence_kind, poll_option, real_score FROM hq_event_observations WHERE alliance_id = ${f.allianceId}`;
    expect(obs!.evidence_kind).toBe("poll_yes");
    expect(obs!.poll_option).toBe(1);
    expect(obs!.real_score).toBeNull();
  });

  it("rejects poll rows carrying a realScore and leaderboard rows without one", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "3" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          pollOptionsConfirmed: true,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "poll_yes", pollOption: 1, realScore: "999" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "poll_row_score_forbidden" });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: null },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_score" });
  });

  it("rejects unknown member ids and unbound jobs", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      parseRows: [{ ocrName: "X", memberId: null }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [{ rowId: null, memberId: `m-${nanoid(8)}`, kind: "leaderboard", realScore: "1" }],
        },
      }),
    ).rejects.toMatchObject({ code: "member_not_found" });

    const unbound = await createMediaJob(f, { eventContext: null });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: unbound.job,
        body: { requestId: `req-${nanoid(12)}`, rows: [] },
      }),
    ).rejects.toMatchObject({ code: "event_not_bound", httpStatus: 409 });
  });

  it("rejects shadow/alternate passes from publishing", async () => {
    const f = await setup();
    const media = await createMediaJob(f, {
      passRole: "shadow",
      parseRows: [{ ocrName: "Roster One", memberId: f.memberId, score: "2" }],
    });
    await expect(
      submitEventEvidenceFromVideoJob({
        session: f.session,
        job: media.job,
        body: {
          requestId: `req-${nanoid(12)}`,
          rows: [
            { rowId: media.rowIds[0]!, memberId: f.memberId, kind: "leaderboard", realScore: "2" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "pass_not_selected", httpStatus: 409 });
  });
});
