import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { JSONValue } from "postgres";

import {
  getE2eSql,
  closeE2eSql,
  createAuthenticatedHqSession,
  createAshedAlliance,
  createAllianceMembership,
  createAllianceRosterMember,
  attachAshedConnectionToSession,
} from "../../../e2e/fixtures/db";
import { getDb, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { syncEventResults } from "@/lib/hq-events/ashed-sync.server";
import { commitReviewedEventEvidence } from "@/lib/hq-events/evidence-repository.server";

/**
 * In-memory Ashed stand-in. `base44Json` serves the list GET,
 * `base44EntityPost` appends; tests can force a lost-reply to exercise the
 * uncertain → re-read → bind path.
 */
const remoteRows = new Map<string, Record<string, unknown>[]>();
let postFailsAfterWrite = false;
const posts: Record<string, unknown>[] = [];

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: vi.fn(async (_conn: unknown, path: string) => {
    const match = /^\/entities\/(\w+)\?q=(.*)$/.exec(path);
    if (!match) throw new Error("unexpected_request");
    const query = JSON.parse(decodeURIComponent(match[2]!)) as Record<
      string,
      unknown
    >;
    const rows = remoteRows.get(match[1]!) ?? [];
    return rows.filter(
      (row) =>
        row.alliance_id === query.alliance_id &&
        row.event_id === query.event_id &&
        (query.team == null || row.team === query.team),
    );
  }),
  base44EntityPost: vi.fn(
    async (_conn: unknown, entity: string, row: Record<string, unknown>) => {
      posts.push({ entity, ...row });
      const created = { id: `remote-${nanoid(8)}`, ...row };
      remoteRows.get(entity)!.push(created);
      if (postFailsAfterWrite) {
        postFailsAfterWrite = false;
        throw new Error("Ashed request failed (503)");
      }
      return created;
    },
  ),
}));

let usedDatabase = false;

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup(
  opts: {
    withCredential?: boolean;
    linked?: boolean;
    family?: string;
    boardKey?: string;
    remoteEventId?: string | null;
  } = {},
) {
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
  const alliance = await createAshedAlliance(sql, {
    tag: `SY${nanoid(5)}`,
    name: "Sync Test",
  });
  const ashedAllianceId = `ashed-${nanoid(8)}`;
  if (opts.linked !== false) {
    await sql`UPDATE alliances SET ashed_alliance_id = ${ashedAllianceId} WHERE id = ${alliance.allianceId}`;
  }
  const officer = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  await createAllianceMembership(sql, {
    hqUserId: officer.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "officer",
    source: "manual",
  });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${officer.sessionId}`;
  if (opts.withCredential !== false) {
    await attachAshedConnectionToSession(sql, officer.sessionId);
  }

  const memberId = `m-${nanoid(8)}`;
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Sync Member",
    ashedMemberId: memberId,
  });

  const family = opts.family ?? "warzone-duel";
  const now = new Date();
  const seriesId = `ser-${nanoid(10)}`;
  const eventId = `ev-${nanoid(10)}`;
  const boardId = `bd-${nanoid(10)}`;
  const boardKey = opts.boardKey ?? "main";
  const remoteEventId =
    opts.remoteEventId === undefined ? `remote-ev-${nanoid(6)}` : opts.remoteEventId;
  await sql`INSERT INTO hq_event_series (id, alliance_id, score_target, name, event_family, created_at, updated_at)
    VALUES (${seriesId}, ${alliance.allianceId}, ${family}, 'EV', ${family}, ${now}, ${now})`;
  await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
    VALUES (${eventId}, ${alliance.allianceId}, ${seriesId}, ${family}, 'EV Event', ${family}, 1, '2099-01-01', 'active', ${now}, ${now})`;
  await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, ashed_event_id, evidence_version, created_at, updated_at)
    VALUES (${boardId}, ${alliance.allianceId}, ${eventId}, ${boardKey}, 'Board', ${remoteEventId}, 1, ${now}, ${now})`;

  return {
    sql,
    allianceId: alliance.allianceId,
    ashedAllianceId,
    sessionId: officer.sessionId,
    hqUserId: officer.hqUserId,
    memberId,
    eventId,
    boardId,
    remoteEventId,
    actor: {
      allianceId: alliance.allianceId,
      hqUserId: officer.hqUserId,
      sessionId: officer.sessionId,
    },
  };
}

function seedRemote(
  entity: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const list = remoteRows.get(entity) ?? [];
  list.push(...rows);
  remoteRows.set(entity, list);
  return list;
}

async function commitScore(
  f: Fixture,
  score: string,
  extra: { kind?: string; memberId?: string } = {},
) {
  return commitReviewedEventEvidence(f.actor, {
    eventId: f.eventId,
    requestId: `req-${nanoid(12)}`,
    sourceKind: "image",
    sourceRef: "test",
    boards: [
      {
        boardId: f.boardId,
        observations: [
          {
            memberId: extra.memberId ?? f.memberId,
            memberName: "Sync Member",
            kind: (extra.kind ?? "leaderboard") as "leaderboard",
            realScore: score,
            provenance: "image",
          },
        ],
      },
    ],
  });
}

async function syncItemFor(f: Fixture, memberId = f.memberId) {
  const rows = await f.sql`SELECT * FROM hq_event_sync_items
    WHERE alliance_id = ${f.allianceId} AND member_id = ${memberId}
    ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

describe.skipIf(!process.env.EVENT_EVIDENCE_DB_TEST)("syncEventResults", () => {
  beforeEach(() => {
    remoteRows.clear();
    posts.length = 0;
    postFailsAfterWrite = false;
  });

  afterAll(async () => {
    if (usedDatabase) await closeE2eSql();
  });

  it("returns not_configured for an unlinked alliance without a credential", async () => {
    const f = await setup({ linked: false, withCredential: false });
    await commitScore(f, "5000");
    const result = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(result.status).toBe("not_configured");
    expect(posts).toHaveLength(0);
    const item = await syncItemFor(f);
    expect(item?.status).toBe("pending");
  });

  it("flags items connection_required when the session has no credential", async () => {
    const f = await setup({ withCredential: false });
    await commitScore(f, "5000");
    const result = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(result.status).toBe("connection_required");
    expect(posts).toHaveLength(0);
    const item = await syncItemFor(f);
    expect(item?.status).toBe("failed");
    expect(item?.error_code).toBe("connection_required");
  });

  it("POSTs missing remote rows and binds remoteRowId; replay posts nothing", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", []);
    await commitScore(f, "5000");

    const first = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(first.synced).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      entity: "SeasonalScore",
      alliance_id: f.ashedAllianceId,
      event_id: f.remoteEventId,
      member_id: f.memberId,
      score: 5000,
    });
    const bound = await syncItemFor(f);
    expect(bound?.status).toBe("synced");
    expect(bound?.remote_row_id).toBeTruthy();

    // Replay: remote row exists and equals desired value — no duplicate POST.
    const second = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(second.status).toBe("ok");
    expect(posts).toHaveLength(1);
  });

  it("poll-after-score creates no duplicate remote row when values match", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", []);
    await commitScore(f, "5000");
    await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(1);

    // A poll Yes observation doesn't change the real-score projection.
    await commitReviewedEventEvidence(f.actor, {
      eventId: f.eventId,
      requestId: `req-${nanoid(12)}`,
      sourceKind: "image",
      sourceRef: "test",
      boards: [
        {
          boardId: f.boardId,
          observations: [
            {
              memberId: f.memberId,
              kind: "poll_yes",
              provenance: "image",
            },
          ],
        },
      ],
    });
    await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(1);
  });

  it("marks an existing differing remote row as conflict (never overwrites)", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", [
      {
        id: "remote-1",
        alliance_id: f.ashedAllianceId,
        event_id: f.remoteEventId,
        member_id: f.memberId,
        score: 9999,
      },
    ]);
    await commitScore(f, "5000");
    const result = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(result.conflict).toBe(1);
    expect(posts).toHaveLength(0);
    expect((await syncItemFor(f))?.status).toBe("conflict");
  });

  it("marks duplicate remote rows as conflict", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", [
      {
        id: "remote-1",
        alliance_id: f.ashedAllianceId,
        event_id: f.remoteEventId,
        member_id: f.memberId,
        score: 5000,
      },
      {
        id: "remote-2",
        alliance_id: f.ashedAllianceId,
        event_id: f.remoteEventId,
        member_id: f.memberId,
        score: 5000,
      },
    ]);
    await commitScore(f, "5000");
    await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(0);
    expect((await syncItemFor(f))?.status).toBe("conflict");
  });

  it("ignores foreign remote rows (wrong alliance/event) and still POSTs", async () => {
    const f = await setup();
    // The list endpoint only returns rows matching the query filter; seed a
    // same-member row under a different alliance that a buggy match could bind.
    seedRemote("SeasonalScore", [
      {
        id: "remote-foreign",
        alliance_id: "other-alliance",
        event_id: f.remoteEventId,
        member_id: f.memberId,
        score: 5000,
      },
    ]);
    await commitScore(f, "5000");
    await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(1);
    const item = await syncItemFor(f);
    expect(item?.status).toBe("synced");
    expect(item?.remote_row_id).not.toBe("remote-foreign");
  });

  it("does not POST when the remote list looks capped", async () => {
    const f = await setup();
    const cap = Array.from({ length: 100 }, (_, i) => ({
      id: `remote-${i}`,
      alliance_id: f.ashedAllianceId,
      event_id: f.remoteEventId,
      member_id: `other-${i}`,
      score: 1,
    }));
    seedRemote("SeasonalScore", cap);
    await commitScore(f, "5000");
    const result = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(0);
    expect(result.status).toBe("partial");
    expect((await syncItemFor(f))?.status).toBe("pending");
    expect((await syncItemFor(f))?.error_code).toBe("incomplete_read");
  });

  it("reconciles a POST-lost-reply: binds on the next run instead of re-POSTing", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", []);
    await commitScore(f, "5000");

    postFailsAfterWrite = true;
    const first = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(first.uncertain).toBe(1);
    expect((await syncItemFor(f))?.status).toBe("uncertain");

    const second = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(second.synced).toBe(1);
    // The first POST actually wrote the row; the retry binds it, no re-POST.
    expect(posts).toHaveLength(1);
    const item = await syncItemFor(f);
    expect(item?.status).toBe("synced");
    expect(item?.remote_row_id).toBeTruthy();
  });

  it("marks scores beyond the JSON safe-integer boundary unsupported", async () => {
    const f = await setup();
    seedRemote("SeasonalScore", []);
    await commitScore(f, "9007199254740993"); // > Number.MAX_SAFE_INTEGER
    await syncEventResults(f.actor, { eventId: f.eventId });
    expect(posts).toHaveLength(0);
    const item = await syncItemFor(f);
    expect(item?.status).toBe("unsupported");
    expect(item?.error_code).toBe("precisionUnsupported");
  });

  it("syncs team-scoped storm boards under the team entity", async () => {
    const f = await setup({
      family: "desert-storm",
      boardKey: "a",
      remoteEventId: `ds-ev-${nanoid(6)}`,
    });
    seedRemote("DesertStormScore", []);
    await commitScore(f, "12345");
    const result = await syncEventResults(f.actor, { eventId: f.eventId });
    expect(result.synced).toBe(1);
    expect(posts[0]).toMatchObject({
      entity: "DesertStormScore",
      team: "a",
      member_id: f.memberId,
    });
  });
});
