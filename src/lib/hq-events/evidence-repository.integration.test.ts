import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import { getE2eSql, closeE2eSql, createAuthenticatedHqSession, createNativeAlliance } from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import {
  commitReviewedEventEvidence,
  confirmEventReadiness,
  loadEventEvidence,
  type EventActor,
} from "./evidence-repository.server";
import { importAshedEventEvidence, linkAshedEvent } from "./ashed-import.server";
import type { ParsedConnection } from "@/lib/connectionString";

const base44JsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/base44/fetch", () => ({
  base44Json: (...args: unknown[]) => base44JsonMock(...args),
}));

let usedDatabase = false;

async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (
    url !==
    (process.env.E2E_DATABASE_URL?.trim() ||
      process.env.LOCAL_DATABASE_URL?.trim())
  ) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `EV${nanoid(5)}`,
    name: "Evidence Test",
  });
  const officer = await createAuthenticatedHqSession(
    sql,
    `${nanoid(12)}@e2e.test`,
  );
  const actor: EventActor = {
    allianceId: alliance.allianceId,
    hqUserId: officer.hqUserId,
    sessionId: officer.sessionId,
  };
  const eventId = `ev-${nanoid(10)}`;
  const boardId = `bd-${nanoid(10)}`;
  const now = new Date();
  await sql`INSERT INTO hq_event_series (id, alliance_id, score_target, name, event_family, created_at, updated_at)
    VALUES (${`ser-${nanoid(10)}`}, ${alliance.allianceId}, 'warzone-duel', 'WZ', 'warzone-duel', ${now}, ${now})`;
  const [series] =
    await sql`SELECT id FROM hq_event_series WHERE alliance_id = ${alliance.allianceId}`;
  await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
    VALUES (${eventId}, ${alliance.allianceId}, ${series!.id}, 'warzone-duel', 'WZ Event', 'warzone-duel', 1, '2025-01-01', 'active', ${now}, ${now})`;
  await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
    VALUES (${boardId}, ${alliance.allianceId}, ${eventId}, 'main', 'Main', 1, ${now}, ${now})`;
  return { sql, actor, eventId, boardId };
}

const obs = (over: Partial<Record<string, unknown>> = {}) => ({
  memberId: `m-${nanoid(6)}`,
  kind: "leaderboard" as const,
  realScore: "5000",
  provenance: "manual" as const,
  sourceRowKey: `row-${nanoid(6)}`,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  base44JsonMock.mockRejectedValue(new Error("unexpected_external_request"));
});

describe.skipIf(process.env.EVENT_EVIDENCE_DB_TEST !== "1")(
  "event evidence ledger (guarded DB)",
  () => {
    afterAll(async () => {
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("commits a batch, recomputes results, bumps evidence_version", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const receipt = await commitReviewedEventEvidence(actor, {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual",
        boards: [
          {
            boardId,
            observations: [
              obs({ memberId: "m-a", realScore: "100" }),
              obs({ memberId: "m-b", realScore: "50" }),
            ],
          },
        ],
      });
      expect(receipt.replayed).toBe(false);
      expect(receipt.changedResults).toBe(2);
      const results =
        await sql`SELECT member_id, real_score::text, evidence_class FROM hq_event_member_results WHERE board_id = ${boardId} ORDER BY member_id`;
      expect(results.map((r) => r.member_id)).toEqual(["m-a", "m-b"]);
      expect(results[0]!.evidence_class).toBe("real");
      const board =
        await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
      expect(board[0]!.evidence_version).toBe(2);
    });

    it("idempotent replay returns same batch without writing", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const input = {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual" as const,
        boards: [{ boardId, observations: [obs({ memberId: "m-x" })] }],
      };
      const first = await commitReviewedEventEvidence(actor, input);
      const second = await commitReviewedEventEvidence(actor, input);
      expect(second.replayed).toBe(true);
      expect(second.batchId).toBe(first.batchId);
      const count =
        await sql`SELECT count(*)::int AS c FROM hq_event_observations WHERE board_id = ${boardId}`;
      expect(count[0]!.c).toBe(1);
    });

    it("same request id with a different body is a conflict", async () => {
      const { actor, eventId, boardId } = await setup();
      const requestId = `req-${nanoid(8)}`;
      await commitReviewedEventEvidence(actor, {
        eventId,
        requestId,
        sourceKind: "manual",
        boards: [{ boardId, observations: [obs()] }],
      });
      await expect(
        commitReviewedEventEvidence(actor, {
          eventId,
          requestId,
          sourceKind: "manual",
          boards: [{ boardId, observations: [obs(), obs()] }],
        }),
      ).rejects.toMatchObject({ code: "request_conflict" });
    });

    it("rolls back the whole batch when one observation is invalid", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      await expect(
        commitReviewedEventEvidence(actor, {
          eventId,
          requestId: `req-${nanoid(8)}`,
          sourceKind: "manual",
          boards: [
            {
              boardId,
              observations: [
                obs({ kind: "poll_yes", realScore: "5" }),
              ],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "poll_row_score_forbidden" });
      const batches =
        await sql`SELECT count(*)::int AS c FROM hq_event_evidence_batches WHERE hq_event_id = ${eventId}`;
      expect(batches[0]!.c).toBe(0);
    });

    it("rejects cross-tenant event and board", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const other = await createNativeAlliance(sql, {
        tag: `OT${nanoid(5)}`,
        name: "Other",
      });
      const outsider: EventActor = { ...actor, allianceId: other.allianceId };
      await expect(
        commitReviewedEventEvidence(outsider, {
          eventId,
          requestId: `req-${nanoid(8)}`,
          sourceKind: "manual",
          boards: [{ boardId, observations: [obs()] }],
        }),
      ).rejects.toMatchObject({ code: "event_not_found" });
      // Cross-tenant board id on a tenant-owned event.
      await expect(
        commitReviewedEventEvidence(actor, {
          eventId,
          requestId: `req-${nanoid(8)}`,
          sourceKind: "manual",
          boards: [{ boardId: `bd-${nanoid(10)}`, observations: [obs()] }],
        }),
      ).rejects.toMatchObject({ code: "board_not_found" });
      // FK-level: an observation row cannot point across alliances.
      const now = new Date();
      await expect(
        sql`INSERT INTO hq_event_observations (id, alliance_id, hq_event_id, board_id, batch_id, member_id, evidence_kind, provenance, created_at)
            VALUES (${`obs-${nanoid(8)}`}, ${other.allianceId}, ${eventId}, ${boardId}, 'none', 'm1', 'leaderboard', 'manual', ${now})`,
      ).rejects.toThrow();
    });

    it("corrections supersede; retraction collapses to no evidence", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const receipt = await commitReviewedEventEvidence(actor, {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual",
        boards: [
          {
            boardId,
            observations: [obs({ memberId: "m-c", realScore: "100" })],
          },
        ],
      });
      const [original] =
        await sql`SELECT id FROM hq_event_observations WHERE board_id = ${boardId}`;
      await commitReviewedEventEvidence(actor, {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual",
        boards: [
          {
            boardId,
            observations: [
              obs({
                memberId: "m-c",
                realScore: "200",
                supersedesObservationId: original!.id,
                correctionReason: "typo",
              }),
            ],
          },
        ],
      });
      let [result] =
        await sql`SELECT real_score::text AS s, evidence_class FROM hq_event_member_results WHERE board_id = ${boardId} AND member_id = 'm-c'`;
      expect(result!.s).toBe("200");
      // Retract the correction → nothing left.
      const [correction] =
        await sql`SELECT id FROM hq_event_observations WHERE board_id = ${boardId} AND id != ${original!.id}`;
      await commitReviewedEventEvidence(actor, {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual",
        boards: [
          { boardId, observations: [], retractsObservationIds: [correction!.id] },
        ],
      });
      [result] =
        await sql`SELECT evidence_class FROM hq_event_member_results WHERE board_id = ${boardId} AND member_id = 'm-c'`;
      expect(result!.evidence_class).toBe("none");
      void receipt;
    });

    it("readiness: fence, empty confirmation, incomplete import, invalidation", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const actorCtx = actor;
      // Empty board needs explicit confirmation.
      await expect(
        confirmEventReadiness(actorCtx, {
          eventId,
          boardId,
          expectedEvidenceVersion: 1,
          action: "mark",
        }),
      ).rejects.toMatchObject({ code: "empty_confirmation_required" });
      const marked = await confirmEventReadiness(actorCtx, {
        eventId,
        boardId,
        expectedEvidenceVersion: 1,
        action: "mark",
        emptyConfirmed: true,
      });
      expect(marked.readyVersion).toBe(1);
      // Stale fence.
      await expect(
        confirmEventReadiness(actorCtx, {
          eventId,
          boardId,
          expectedEvidenceVersion: 999,
          action: "mark",
          emptyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "stale_evidence_version" });
      // New evidence bumps version → ready is stale and empty flag resets.
      await commitReviewedEventEvidence(actor, {
        eventId,
        requestId: `req-${nanoid(8)}`,
        sourceKind: "manual",
        boards: [{ boardId, observations: [obs()] }],
      });
      const page = await loadEventEvidence(actor, { eventId });
      const board = page!.boards.find((b) => b.id === boardId)!;
      expect(board.ready).toBe(false);
      expect(board.emptyConfirmed).toBe(0);
      // Explicit invalidation.
      const cleared = await confirmEventReadiness(actor, {
        eventId,
        boardId,
        expectedEvidenceVersion: 0,
        action: "invalidate",
      });
      expect(cleared.readyVersion).toBeNull();
      // Incomplete import blocks readiness.
      await sql`INSERT INTO hq_event_evidence_batches (id, alliance_id, hq_event_id, source_kind, status, import_status, created_at, updated_at)
        VALUES (${`bad-${nanoid(8)}`}, ${actor.allianceId}, ${eventId}, 'ashed_import', 'committed', 'incomplete', ${new Date()}, ${new Date()})`;
      const [b] =
        await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
      await expect(
        confirmEventReadiness(actor, {
          eventId,
          boardId,
          expectedEvidenceVersion: b!.evidence_version,
          action: "mark",
          emptyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "import_incomplete" });
    });

    it("readySources: rejects unknown/empty/foreign-board ids, scopes empty check", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      // Unknown id and empty array both reject.
      const [v] =
        await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
      await expect(
        confirmEventReadiness(actor, {
          eventId, boardId, expectedEvidenceVersion: v!.evidence_version,
          action: "mark", readySources: [`nope-${nanoid(6)}`],
          emptyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "invalid_ready_sources" });
      await expect(
        confirmEventReadiness(actor, {
          eventId, boardId, expectedEvidenceVersion: v!.evidence_version,
          action: "mark", readySources: [], emptyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "invalid_ready_sources" });
      // A committed batch on a DIFFERENT board is not a valid source.
      const otherBoard = `bd-${nanoid(10)}`;
      await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
        VALUES (${otherBoard}, ${actor.allianceId}, ${eventId}, 'other', 'Other', 1, ${new Date()}, ${new Date()})`;
      const other = await commitReviewedEventEvidence(actor, {
        eventId, requestId: `req-${nanoid(8)}`, sourceKind: "manual",
        boards: [{ boardId: otherBoard, observations: [obs({ memberId: "m-other" })] }],
      });
      await expect(
        confirmEventReadiness(actor, {
          eventId, boardId, expectedEvidenceVersion: v!.evidence_version,
          action: "mark", readySources: [other.batchId], emptyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "invalid_ready_sources" });
      // Commit one real scored batch on this board.
      const good = await commitReviewedEventEvidence(actor, {
        eventId, requestId: `req-${nanoid(8)}`, sourceKind: "manual",
        boards: [{ boardId, observations: [obs({ memberId: "m-scored" })] }],
      });
      const [v2] =
        await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
      // An empty committed batch contributes no scored members → needs confirm.
      const empty = await commitReviewedEventEvidence(actor, {
        eventId, requestId: `req-${nanoid(8)}`, sourceKind: "manual",
        boards: [{ boardId, observations: [] }],
      });
      const [v3] =
        await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
      await expect(
        confirmEventReadiness(actor, {
          eventId, boardId, expectedEvidenceVersion: v3!.evidence_version,
          action: "mark", readySources: [empty.batchId],
        }),
      ).rejects.toMatchObject({ code: "empty_confirmation_required" });
      // The scored batch alone satisfies the check.
      const marked = await confirmEventReadiness(actor, {
        eventId, boardId, expectedEvidenceVersion: v3!.evidence_version,
        action: "mark", readySources: [good.batchId],
      });
      expect(marked.readyVersion).toBe(v3!.evidence_version);
      void v2;
    });

    it("concurrent board commits serialize without deadlock", async () => {
      const { actor, eventId, boardId } = await setup();
      const [a, b] = await Promise.all([
        commitReviewedEventEvidence(actor, {
          eventId,
          requestId: `req-${nanoid(8)}`,
          sourceKind: "manual",
          boards: [{ boardId, observations: [obs({ memberId: "cc-a" })] }],
        }),
        commitReviewedEventEvidence(actor, {
          eventId,
          requestId: `req-${nanoid(8)}`,
          sourceKind: "manual",
          boards: [{ boardId, observations: [obs({ memberId: "cc-b" })] }],
        }),
      ]);
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(false);
      const page = await loadEventEvidence(actor, { eventId, boardId });
      const members = page!.results.map((r) => r.memberId).sort();
      expect(members).toEqual(["cc-a", "cc-b"]);
    });

    it("ashed import: tenant row rejection, staged gate, replay, conflict, cap", async () => {
      const { sql, actor, eventId, boardId } = await setup();
      const connection = { ok: true } as unknown as ParsedConnection;
      const remoteEventId = `rem-${nanoid(8)}`;

      // Wrong-tenant row → rejected, nothing written.
      base44JsonMock.mockResolvedValueOnce([
        { id: "r1", member_id: "m1", score: 10, event_id: "other-event" },
      ]);
      await expect(
        importAshedEventEvidence(
          actor,
          connection,
          {
            eventId,
            remoteEventId,
            requestId: `req-${nanoid(8)}`,
            submitEntity: "SeasonalEventScore",
            classification: { kind: "real" },
          },
          { ashedAllianceId: "ashed-1" },
        ),
      ).rejects.toMatchObject({ code: "wrong_tenant_remote_row" });

      base44JsonMock.mockResolvedValueOnce([
        {
          id: "r1",
          member_id: "m1",
          score: 10,
          event_id: remoteEventId,
          hq_event_id: "other-hq-event",
        },
      ]);
      await expect(
        importAshedEventEvidence(
          actor,
          connection,
          {
            eventId,
            remoteEventId,
            requestId: `req-${nanoid(8)}`,
            submitEntity: "SeasonalEventScore",
            classification: { kind: "real" },
          },
          { ashedAllianceId: "ashed-1" },
        ),
      ).rejects.toMatchObject({ code: "wrong_tenant_remote_row" });

      // Unconfirmed → staged, no observations, no results.
      base44JsonMock.mockResolvedValueOnce([
        { id: "r1", member_id: "m1", member_name: "P1", score: 2000, event_id: remoteEventId },
      ]);
      const staged = await importAshedEventEvidence(
        actor,
        connection,
        {
          eventId,
          remoteEventId,
          requestId: `req-${nanoid(8)}`,
          submitEntity: "SeasonalEventScore",
          classification: { kind: "unconfirmed" },
        },
        { ashedAllianceId: "ashed-1" },
      );
      expect(staged.staged).toBe(true);
      const resultCount =
        await sql`SELECT count(*)::int AS c FROM hq_event_member_results WHERE hq_event_id = ${eventId}`;
      expect(resultCount[0]!.c).toBe(0);

      // Legacy-confirmed import maps 2000 → legacy participation.
      base44JsonMock.mockResolvedValueOnce([
        { id: "r1", member_id: "m1", member_name: "P1", score: 2000, event_id: remoteEventId },
      ]);
      const legacy = await importAshedEventEvidence(
        actor,
        connection,
        {
          eventId,
          remoteEventId,
          requestId: `req-${nanoid(8)}`,
          submitEntity: "SeasonalEventScore",
          classification: { kind: "legacy" },
        },
        { ashedAllianceId: "ashed-1" },
      );
      expect(legacy.staged).toBe(false);
      let [result] =
        await sql`SELECT evidence_class FROM hq_event_member_results WHERE hq_event_id = ${eventId} AND member_id = 'm1'`;
      expect(result!.evidence_class).toBe("legacy_leaderboard");

      // Identical re-import is a no-op.
      base44JsonMock.mockResolvedValueOnce([
        { id: "r1", member_id: "m1", member_name: "P1", score: 2000, event_id: remoteEventId },
      ]);
      const replay = await importAshedEventEvidence(
        actor,
        connection,
        {
          eventId,
          remoteEventId,
          requestId: `req-${nanoid(8)}`,
          submitEntity: "SeasonalEventScore",
          classification: { kind: "legacy" },
        },
        { ashedAllianceId: "ashed-1" },
      );
      expect(replay.replayed).toBe(true);

      // Changed remote record produces new reviewable evidence.
      base44JsonMock.mockResolvedValueOnce([
        { id: "r1", member_id: "m1", member_name: "P1", score: 2000, event_id: remoteEventId },
      ]);
      const changed = await importAshedEventEvidence(
        actor,
        connection,
        {
          eventId,
          remoteEventId,
          requestId: `req-${nanoid(8)}`,
          submitEntity: "SeasonalEventScore",
          classification: { kind: "real" },
        },
        { ashedAllianceId: "ashed-1" },
      );
      expect(changed.replayed).toBe(false);
      [result] =
        await sql`SELECT evidence_class FROM hq_event_member_results WHERE hq_event_id = ${eventId} AND member_id = 'm1'`;
      expect(result!.evidence_class).toBe("real");

      // Hitting the list cap records an incomplete import.
      const cappedRemoteId = `rem-${nanoid(8)}`;
      const capped = Array.from({ length: 2000 }, (_, i) => ({
        id: `cap-${i}`,
        member_id: `cap-${i}`,
        score: 1,
        event_id: cappedRemoteId,
      }));
      base44JsonMock.mockResolvedValueOnce(capped);
      const incomplete = await importAshedEventEvidence(
        actor,
        connection,
        {
          eventId,
          remoteEventId: cappedRemoteId,
          requestId: `req-${nanoid(8)}`,
          submitEntity: "SeasonalEventScore",
          classification: { kind: "real" },
        },
        { ashedAllianceId: "ashed-1" },
      );
      expect(incomplete.incomplete).toBe(true);
      const [batch] =
        await sql`SELECT import_status FROM hq_event_evidence_batches WHERE id = ${incomplete.batchId}`;
      expect(batch!.import_status).toBe("incomplete");
      void boardId;
      void connection;
    });

    it("linkAshedEvent is idempotent and refuses cross-event reuse", async () => {
      const { sql, actor, eventId } = await setup();
      const remote = `rem-${nanoid(8)}`;
      const first = await linkAshedEvent(actor, {
        eventId,
        remoteEventId: remote,
      });
      expect(first.alreadyLinked).toBe(false);
      const second = await linkAshedEvent(actor, {
        eventId,
        remoteEventId: remote,
      });
      expect(second.alreadyLinked).toBe(true);
      const [otherEvent] =
        await sql`INSERT INTO hq_events (id, alliance_id, score_target, name, start_date, status, created_at, updated_at)
          VALUES (${`ev-${nanoid(10)}`}, ${actor.allianceId}, 'warzone-duel', 'Other', '2025-01-02', 'active', ${new Date()}, ${new Date()})
          RETURNING id`;
      await expect(
        linkAshedEvent(actor, {
          eventId: otherEvent!.id,
          remoteEventId: remote,
        }),
      ).rejects.toMatchObject({ code: "remote_id_linked_elsewhere" });
    });
  },
);
