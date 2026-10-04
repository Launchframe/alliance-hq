import { afterAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import {
  getE2eSql,
  closeE2eSql,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createAllianceRosterMember,
} from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import {
  commitReviewedEventEvidence,
  confirmEventReadiness,
  type EventActor,
} from "@/lib/hq-events/evidence-repository.server";
import { previewEventEligibility } from "@/lib/trains/event-eligibility.server";
import { rollEventForTrain } from "@/lib/trains/event-draw.server";
import {
  getConductorRecord,
  lockConductorRecord,
} from "@/lib/trains/repository";
import { rollForConductor } from "@/lib/trains/service";
import { nominateConductorForDate } from "@/lib/trains/conductor-confirmation.server";
import { TrainRollError } from "@/lib/trains/roll-errors.server";
import type { EventScoresRule } from "@/lib/trains/rules/catalog.shared";

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: vi.fn().mockRejectedValue(new Error("unexpected_external_request")),
}));

let usedDatabase = false;

const DATE = "2099-01-06";

function eventScoresRule(eventId: string, over: Partial<EventScoresRule> = {}): EventScoresRule {
  return {
    kind: "event_scores",
    source: {
      target: "warzone-duel",
      seriesId: null,
      occurrenceId: eventId,
      boardKey: "main",
      teamScope: null,
    },
    eligibility: "scored",
    topN: 10,
    fallback: "none",
    ...over,
  } as EventScoresRule;
}

async function setup(opts: { memberCount?: number; date?: string } = {}) {
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
    tag: `ED${nanoid(5)}`,
    name: "Event Draw Test",
  });
  const officer = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  const actor: EventActor = {
    allianceId: alliance.allianceId,
    hqUserId: officer.hqUserId,
    sessionId: officer.sessionId,
  };

  const members: string[] = [];
  const count = opts.memberCount ?? 30;
  for (let i = 0; i < count; i += 1) {
    const memberId = `m-${nanoid(8)}`;
    await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: `Member ${i}`,
      ashedMemberId: memberId,
    });
    members.push(memberId);
  }

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

  const rule = eventScoresRule(eventId);
  await sql`INSERT INTO train_day_configs (id, alliance_id, date, conductor_rule, vip_rule, is_override, created_at)
    VALUES (${`dc-${nanoid(8)}`}, ${alliance.allianceId}, ${opts.date ?? DATE}, ${JSON.stringify(rule)}, ${JSON.stringify(
      { ...eventScoresRule(eventId), eligibility: "participants", topN: "all", fallback: "none" },
    )}, 1, ${now})`;

  return { sql, actor, allianceId: alliance.allianceId, eventId, boardId, members, rule };
}

async function commitScores(
  actor: EventActor,
  eventId: string,
  boardId: string,
  observations: { memberId: string; kind: "leaderboard" | "poll_yes" | "poll_no"; realScore?: string | null }[],
) {
  return commitReviewedEventEvidence(actor, {
    eventId,
    requestId: `req-${nanoid(8)}`,
    sourceKind: "manual",
    boards: [
      {
        boardId,
        observations: observations.map((o, i) => ({
          memberId: o.memberId,
          kind: o.kind,
          realScore: o.realScore ?? null,
          provenance: "manual" as const,
          sourceRowKey: `row-${i}-${nanoid(4)}`,
        })),
      },
    ],
  });
}

async function markReady(actor: EventActor, eventId: string, boardId: string, sql: ReturnType<typeof getE2eSql>, emptyConfirmed = false) {
  const [board] = await sql`SELECT evidence_version FROM hq_event_boards WHERE id = ${boardId}`;
  return confirmEventReadiness(actor, {
    eventId,
    boardId,
    expectedEvidenceVersion: board!.evidence_version,
    action: "mark",
    emptyConfirmed,
  });
}

describe.skipIf(process.env.EVENT_EVIDENCE_DB_TEST !== "1")(
  "event train draws (guarded DB)",
  () => {
    afterAll(async () => {
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("7 real + 20 Yes: conductor Top 10 draws from the 7; VIP from 27 minus conductor", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 30 });
      const reals = members.slice(0, 7);
      const yeses = members.slice(7, 27);
      await commitScores(actor, eventId, boardId, [
        ...reals.map((memberId, i) => ({ memberId, kind: "leaderboard" as const, realScore: String(9000 - i * 100) })),
        ...yeses.map((memberId) => ({ memberId, kind: "poll_yes" as const })),
      ]);
      await markReady(actor, eventId, boardId, sql);

      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      expect(preview.eligibility.ok).toBe(true);
      if (!preview.eligibility.ok) return;
      expect(preview.eligibility.candidates).toHaveLength(7);
      expect(preview.fingerprint).toBeTruthy();

      const conductor = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      expect(reals).toContain(conductor.result.memberId);

      const vipPreview = await previewEventEligibility(actor, { date: DATE, role: "vip" });
      if (!vipPreview.eligibility.ok) throw new Error("vip preview not ok");
      // 27 qualifying minus the drawn conductor (day-spin exclusion).
      expect(vipPreview.eligibility.candidates).toHaveLength(26);
      expect(
        vipPreview.eligibility.candidates.map((c) => c.memberId),
      ).not.toContain(conductor.result.memberId);
    });

    it("duplicate requestId replays the same winner; different signature 409s", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 10 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "500" },
      ]);
      await markReady(actor, eventId, boardId, sql);
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });

      const requestId = `spin-${nanoid(8)}`;
      const first = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      const replay = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.result.memberId).toBe(first.result.memberId);
      expect(replay.draw.id).toBe(first.draw.id);

      // Any signature field difference (fingerprint, ack flag) conflicts.
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "conductor",
          requestId,
          expectedEligibilityFingerprint: "different-fingerprint",
        }),
      ).rejects.toSatisfy((e) => (e as TrainRollError).details.code === "REQUEST_CONFLICT");
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "conductor",
          requestId,
          expectedEligibilityFingerprint: preview.fingerprint!,
          acknowledgePollFallback: true,
        }),
      ).rejects.toSatisfy((e) => (e as TrainRollError).details.code === "REQUEST_CONFLICT");
      // Replay of the vip role under the same requestId also conflicts.
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "vip",
          requestId,
          expectedEligibilityFingerprint: preview.fingerprint!,
        }),
      ).rejects.toSatisfy((e) => (e as TrainRollError).details.code === "REQUEST_CONFLICT");
    });

    it("roster change after preview invalidates the fingerprint (409)", async () => {
      const { sql, actor, allianceId, eventId, boardId, members } = await setup({ memberCount: 10 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "500" },
        { memberId: members[1]!, kind: "leaderboard", realScore: "400" },
      ]);
      await markReady(actor, eventId, boardId, sql);
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });

      await sql`UPDATE alliance_members SET status = 'left' WHERE alliance_id = ${allianceId} AND ashed_member_id = ${members[0]!}`;

      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "conductor",
          requestId: `spin-${nanoid(8)}`,
          expectedEligibilityFingerprint: preview.fingerprint!,
        }),
      ).rejects.toSatisfy((e) => (e as TrainRollError).details.code === "ELIGIBILITY_CHANGED");
    });

    it("not-ready board blocks the draw with pending_evidence", async () => {
      const { actor, eventId, boardId, members } = await setup({ memberCount: 5 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "500" },
      ]);
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      expect(preview.eligibility).toEqual({ ok: false, reason: "not_ready" });
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "conductor",
          requestId: `spin-${nanoid(8)}`,
          expectedEligibilityFingerprint: preview.fingerprint ?? "x",
        }),
      ).rejects.toSatisfy((e) =>
        ["PENDING_EVIDENCE", "ELIGIBILITY_CHANGED"].includes(
          (e as TrainRollError).details.code,
        ),
      );
    });

    it("VIP draw requires a locked conductor and excludes the conductor", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 10 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "900" },
        { memberId: members[1]!, kind: "leaderboard", realScore: "800" },
      ]);
      await markReady(actor, eventId, boardId, sql);

      const vipPreview = await previewEventEligibility(actor, { date: DATE, role: "vip" });
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "vip",
          requestId: `spin-${nanoid(8)}`,
          expectedEligibilityFingerprint: vipPreview.fingerprint ?? "x",
        }),
      ).rejects.toSatisfy((e) =>
        ["EVENT_NOT_SELECTED", "ELIGIBILITY_CHANGED", "PENDING_EVIDENCE"].includes(
          (e as TrainRollError).details.code,
        ),
      );

      // Conductor spin, lock, then VIP draw excludes the locked conductor.
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      const conductor = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      const record = await getConductorRecord(actor.allianceId, DATE);
      await lockConductorRecord(record!.id, actor.allianceId, actor.hqUserId);

      const vipPreview2 = await previewEventEligibility(actor, { date: DATE, role: "vip" });
      if (!vipPreview2.eligibility.ok) throw new Error("vip preview failed");
      expect(vipPreview2.eligibility.candidates.map((c) => c.memberId)).not.toContain(
        conductor.result.memberId,
      );
      const vip = await rollEventForTrain(actor, {
        date: DATE,
        role: "vip",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: vipPreview2.fingerprint!,
      });
      expect(vip.result.memberId).not.toBe(conductor.result.memberId);
      const after = await getConductorRecord(actor.allianceId, DATE);
      expect(after?.vipMemberId).toBe(vip.result.memberId);
      expect(after?.vipEventDrawId).toBe(vip.draw.id);
    });

    it("failed VIP save leaves no receipt and no burned exclusion", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 10 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "900" },
        { memberId: members[1]!, kind: "leaderboard", realScore: "800" },
      ]);
      await markReady(actor, eventId, boardId, sql);
      const vipPreview = await previewEventEligibility(actor, { date: DATE, role: "vip" });
      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "vip",
          requestId: `spin-${nanoid(8)}`,
          expectedEligibilityFingerprint: vipPreview.fingerprint ?? "x",
        }),
      ).rejects.toBeInstanceOf(TrainRollError);
      const draws = await sql`SELECT id FROM train_event_draws WHERE alliance_id = ${actor.allianceId}`;
      expect(draws).toHaveLength(0);
      const exclusions = await sql`SELECT member_id FROM train_day_spin_exclusions WHERE alliance_id = ${actor.allianceId} AND date = ${DATE}`;
      expect(exclusions).toHaveLength(0);
    });

    it("poll fallback requires empty confirmation + acknowledgement", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 10 });
      const yeses = members.slice(0, 4);
      await commitScores(actor, eventId, boardId, yeses.map((memberId) => ({ memberId, kind: "poll_yes" as const })));
      await markReady(actor, eventId, boardId, sql, true);

      // Day rule needs the fallback flag — rewrite the day config.
      const fallbackRule = {
        ...eventScoresRule(eventId),
        fallback: "confirmed_poll_yes",
      };
      await sql`UPDATE train_day_configs SET conductor_rule = ${JSON.stringify(fallbackRule)} WHERE alliance_id = ${actor.allianceId} AND date = ${DATE}`;

      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      if (!preview.eligibility.ok) throw new Error("preview failed");
      expect(preview.eligibility.fallback.available).toBe(true);
      expect(preview.eligibility.fallback.count).toBe(4);

      await expect(
        rollEventForTrain(actor, {
          date: DATE,
          role: "conductor",
          requestId: `spin-${nanoid(8)}`,
          expectedEligibilityFingerprint: preview.fingerprint!,
        }),
      ).rejects.toSatisfy((e) => (e as TrainRollError).details.code === "CONFIRM_POLL_FALLBACK");

      const draw = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: preview.fingerprint!,
        acknowledgePollFallback: true,
      });
      expect(yeses).toContain(draw.result.memberId);
      expect(draw.draw.fallbackUsed).toBe(1);

      // Receipt snapshots the fallback pool actually drawn from.
      const snapshot = draw.draw.candidates as {
        memberId: string;
        memberName: string | null;
        evidenceKind: string;
      }[];
      expect(snapshot).toHaveLength(4);
      expect(snapshot.map((c) => c.memberId).sort()).toEqual([...yeses].sort());
      for (const candidate of snapshot) {
        expect(candidate.evidenceKind).toBe("poll_yes");
        expect(candidate.memberName).toBeTruthy();
      }
      // candidates_hash is a real content hash, not the request signature.
      expect(draw.draw.candidatesHash).toMatch(/^[0-9a-f]{64}$/);
      expect(draw.draw.candidatesHash).not.toBe(draw.draw.requestSignature);
    });

    it("same event on the next date starts fresh (no day exclusion)", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 10 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "900" },
      ]);
      await markReady(actor, eventId, boardId, sql);
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      const draw = await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      const exclusions = await sql`SELECT date FROM train_day_spin_exclusions WHERE alliance_id = ${actor.allianceId}`;
      expect(exclusions.map((r) => r.date)).toEqual([DATE]);
      void draw;
    });

    it("legacy event_top_x rules cannot spin", async () => {
      const { sql, allianceId } = await setup({ memberCount: 5 });
      await sql`UPDATE train_day_configs SET conductor_rule = ${JSON.stringify({ kind: "event_top_x", eventKey: "capitol_war", topN: 10 })} WHERE alliance_id = ${allianceId} AND date = ${DATE}`;
      await expect(
        rollForConductor({ allianceId, date: DATE }),
      ).rejects.toSatisfy(
        (e) => e instanceof TrainRollError && e.details.code === "EVENT_NOT_SELECTED",
      );
    });

    it("background nomination never auto-draws for event rules", async () => {
      const { sql, allianceId } = await setup({ memberCount: 5 });
      await sql`UPDATE alliances SET train_conductor_confirmation_enabled = 1 WHERE id = ${allianceId}`;
      const result = await nominateConductorForDate({
        allianceId,
        trainDate: DATE,
        trigger: { mode: "scheduled_reset", anchor: "day_before_train" },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("event_action_required");
      const record = await getConductorRecord(allianceId, DATE);
      expect(record?.conductorMemberId ?? null).toBeNull();
    });

    it("stale event draw blocks lock with readiness_invalidated", async () => {
      const { sql, actor, eventId, boardId, members } = await setup({ memberCount: 5 });
      await commitScores(actor, eventId, boardId, [
        { memberId: members[0]!, kind: "leaderboard", realScore: "900" },
      ]);
      await markReady(actor, eventId, boardId, sql);
      const preview = await previewEventEligibility(actor, { date: DATE, role: "conductor" });
      await rollEventForTrain(actor, {
        date: DATE,
        role: "conductor",
        requestId: `spin-${nanoid(8)}`,
        expectedEligibilityFingerprint: preview.fingerprint!,
      });
      const record = await getConductorRecord(actor.allianceId, DATE);
      expect(record?.conductorEventDrawId).toBeTruthy();

      // Evidence changes → ready_version diverges from the receipt.
      await commitScores(actor, eventId, boardId, [
        { memberId: members[1]!, kind: "leaderboard", realScore: "950" },
      ]);

      await expect(
        lockConductorRecord(record!.id, actor.allianceId, actor.hqUserId),
      ).rejects.toSatisfy(
        (e) => e instanceof TrainRollError && e.details.code === "READINESS_INVALIDATED",
      );
    });
  },
);
