import { afterAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import {
  getE2eSql,
  closeE2eSql,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createAllianceMembership,
  createAllianceRosterMember,
} from "../../../e2e/fixtures/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import {
  commitReviewedEventEvidence,
  retractEventEvidenceBatch,
} from "@/lib/hq-events/evidence-repository.server";
import { commitScoreRowsToEventLedger } from "@/lib/hq-events/evidence-submit.server";

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: vi.fn().mockRejectedValue(new Error("unexpected_external_request")),
  base44EntityPost: vi
    .fn()
    .mockRejectedValue(new Error("unexpected_external_request")),
}));

let usedDatabase = false;

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup(
  opts: { family?: string; boards?: { boardKey: string; name?: string }[] } = {},
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
  const alliance = await createNativeAlliance(sql, {
    tag: `RT${nanoid(5)}`,
    name: "Retraction Test",
  });
  const officer = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  await createAllianceMembership(sql, {
    hqUserId: officer.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "officer",
    source: "manual",
  });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${officer.sessionId}`;

  const memberId = `m-${nanoid(8)}`;
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Member One",
    ashedMemberId: memberId,
  });

  const family = opts.family ?? "warzone-duel";
  const now = new Date();
  const seriesId = `ser-${nanoid(10)}`;
  const eventId = `ev-${nanoid(10)}`;
  await sql`INSERT INTO hq_event_series (id, alliance_id, score_target, name, event_family, created_at, updated_at)
    VALUES (${seriesId}, ${alliance.allianceId}, ${family}, 'EV', ${family}, ${now}, ${now})`;
  await sql`INSERT INTO hq_events (id, alliance_id, series_id, score_target, name, event_family, policy_version, start_date, status, created_at, updated_at)
    VALUES (${eventId}, ${alliance.allianceId}, ${seriesId}, ${family}, 'EV Event', ${family}, 1, '2099-01-01', 'active', ${now}, ${now})`;
  const boardIds: string[] = [];
  for (const board of opts.boards ?? [{ boardKey: "main" }]) {
    const boardId = `bd-${nanoid(10)}`;
    boardIds.push(boardId);
    await sql`INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, evidence_version, created_at, updated_at)
      VALUES (${boardId}, ${alliance.allianceId}, ${eventId}, ${board.boardKey}, ${board.name ?? board.boardKey}, 1, ${now}, ${now})`;
  }

  return {
    sql,
    allianceId: alliance.allianceId,
    actor: {
      allianceId: alliance.allianceId,
      hqUserId: officer.hqUserId,
      sessionId: officer.sessionId,
    },
    memberId,
    eventId,
    boardIds,
  };
}

async function boardRow(f: Fixture, boardId: string) {
  const [row] =
    await f.sql`SELECT evidence_version, empty_confirmed FROM hq_event_boards WHERE id = ${boardId}`;
  return row!;
}

describe.skipIf(!process.env.EVENT_EVIDENCE_DB_TEST)(
  "event ledger unification",
  () => {
    afterAll(async () => {
      if (usedDatabase) await closeE2eSql();
    });

    it("commitScoreRowsToEventLedger writes a storm-board save through the ledger", async () => {
      const f = await setup({
        family: "desert-storm",
        boards: [{ boardKey: "a" }, { boardKey: "b" }],
      });

      const result = await commitScoreRowsToEventLedger({
        actor: f.actor,
        job: { id: `job-${nanoid(8)}` },
        eventId: f.eventId,
        boardKey: null,
        team: "A",
        scoreTargetId: "desert-storm",
        rows: [
          {
            id: "r1",
            memberId: f.memberId,
            memberName: "Member One",
            score: "12,345",
            rank: 1,
          },
        ],
      });

      expect(result?.boardId).toBe(f.boardIds[0]);

      const results = await f.sql`SELECT member_id, real_score, evidence_class
        FROM hq_event_member_results WHERE board_id = ${f.boardIds[0]}`;
      expect(results).toHaveLength(1);
      expect(results[0]!.real_score).toBe("12345");
      expect(results[0]!.evidence_class).toBe("real");

      const syncItems = await f.sql`SELECT status FROM hq_event_sync_items
        WHERE board_id = ${f.boardIds[0]}`;
      expect(syncItems).toHaveLength(1);
      expect(syncItems[0]!.status).toBe("pending");

      // Board B untouched.
      const other = await f.sql`SELECT COUNT(*)::int AS c FROM hq_event_observations WHERE board_id = ${f.boardIds[1]}`;
      expect(other[0]!.c).toBe(0);
    });

    it("retractEventEvidenceBatch retracts observations, recomputes, and bumps evidence_version", async () => {
      const f = await setup();
      const boardId = f.boardIds[0]!;
      const sourceRef = `job-${nanoid(8)}`;

      await commitReviewedEventEvidence(f.actor, {
        eventId: f.eventId,
        requestId: `req-${nanoid(12)}`,
        sourceKind: "image",
        sourceRef,
        boards: [
          {
            boardId,
            observations: [
              {
                memberId: f.memberId,
                memberName: "Member One",
                kind: "leaderboard",
                realScore: "777",
                provenance: "image",
              },
            ],
          },
        ],
      });

      const before = await boardRow(f, boardId);
      expect(before.evidence_version).toBe(2);
      const [resultBefore] =
        await f.sql`SELECT evidence_class FROM hq_event_member_results WHERE board_id = ${boardId} AND member_id = ${f.memberId}`;
      expect(resultBefore!.evidence_class).toBe("real");

      const retracted = await retractEventEvidenceBatch(f.actor, {
        eventId: f.eventId,
        sourceRef,
      });
      expect(retracted.retracted).toBe(1);
      expect(retracted.boardIds).toEqual([boardId]);

      const after = await boardRow(f, boardId);
      expect(after.evidence_version).toBe(3);
      expect(after.empty_confirmed).toBe(0);

      const obs = await f.sql`SELECT retracted FROM hq_event_observations WHERE board_id = ${boardId}`;
      expect(obs.every((row) => row.retracted === 1)).toBe(true);

      const [resultAfter] =
        await f.sql`SELECT evidence_class, real_score FROM hq_event_member_results WHERE board_id = ${boardId} AND member_id = ${f.memberId}`;
      expect(resultAfter!.evidence_class).toBe("none");
      expect(resultAfter!.real_score).toBeNull();

      const batch = await f.sql`SELECT status FROM hq_event_evidence_batches WHERE alliance_id = ${f.allianceId}`;
      expect(batch[0]!.status).toBe("retracted");
    });
  },
);
