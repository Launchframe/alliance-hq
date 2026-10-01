import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  resolve: vi.fn(),
  validate: vi.fn(),
  attemptSync: vi.fn(async () => null),
  syncOpponent: vi.fn(async () => null),
}));

vi.mock("@/lib/vs-scores/ashed-transport.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/vs-scores/ashed-transport.server")
    >();
  return {
    ...actual,
    resolveVsAshedConnection: transport.resolve,
    validateVsAshedMember: transport.validate,
  };
});
vi.mock("@/lib/vs-performance/matchup-sync.server", () => ({
  attemptVsOpponentSync: transport.attemptSync,
  syncAshedOpponentInfo: transport.syncOpponent,
}));

import { and, eq } from "drizzle-orm";

import { getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import {
  createNativeVsScenario,
  seedVsReviewJob,
} from "../../../e2e/fixtures/vs-evidence";
import { getDb, getSqlClient, schema } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { getWeekStartMonday } from "@/lib/trains/game-time";
import type { VsActor } from "./weekly-view.shared";
import {
  initializeVsVideoEvidence,
  vsVideoScopeKey,
} from "./video-evidence.server";
import {
  commitVsVideoSubmission,
  saveVsVideoMatchOnly,
  type VsVideoMatchSaveResult,
} from "./video-evidence-submit.server";
import type { VsVideoMatchSubmission } from "./video-evidence.shared";
import type { VsCaptureCandidate } from "./vs-capture.shared";

const monday = "2026-08-31";
const weekStart = getWeekStartMonday(monday);
let usedDatabase = false;

async function stageReadyEvidence(
  sql: ReturnType<typeof getE2eSql>,
  input: {
    allianceId: string;
    jobId: string;
    groupId?: string | null;
    sessionId: string;
    recordedDate: string;
    period?: "daily" | "weekly";
    kind?: "daily_totals" | "weekly_overview";
  },
) {
  await initializeVsVideoEvidence(input.jobId, input.sessionId, {
    recordedDate: input.recordedDate,
    period: input.period ?? "daily",
  });
  const scopeKey = vsVideoScopeKey({
    id: input.jobId,
    groupId: input.groupId ?? null,
  });
  await getDb()
    .update(schema.videoVsEvidence)
    .set({
      status: "ready",
      storageKey: `videos/${input.jobId}/vs-match/test-sealed`,
      imageSha256: "test-sha",
      candidate: { kind: input.kind ?? "daily_totals" } as VsCaptureCandidate,
      imageVersion: 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, scopeKey),
        eq(schema.videoVsEvidence.allianceId, input.allianceId),
      ),
    );
  const [row] = await sql`SELECT version FROM video_vs_evidence WHERE scope_key = ${scopeKey} AND alliance_id = ${input.allianceId}`;
  return { scopeKey, version: row.version as number };
}

async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  const localUrl = process.env.LOCAL_DATABASE_URL?.trim();
  if (!e2eUrl || url !== e2eUrl || localUrl !== e2eUrl) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
  const sql = getE2eSql();
  const fixture = await createNativeVsScenario(sql);
  await sql`UPDATE alliances SET game_server_number = 1203 WHERE id = ${fixture.allianceId}`;
  const actor: VsActor = {
    sessionId: fixture.owner.sessionId,
    hqUserId: fixture.owner.hqUserId,
    allianceId: fixture.allianceId,
  };
  async function stageJob(score = 1) {
    const seeded = await seedVsReviewJob(sql, {
      allianceId: fixture.allianceId,
      actor: fixture.owner,
      recordedDate: monday,
      rows: [
        {
          memberId: fixture.member.memberId,
          memberName: fixture.member.memberName,
          score,
        },
      ],
    });
    const [job] = await getDb()
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, seeded.jobId))
      .limit(1);
    const access = {
      actor,
      job,
      scopeKey: vsVideoScopeKey({
        id: seeded.jobId,
        groupId: job?.groupId ?? null,
      }),
    };
    return { ...seeded, job, access };
  }
  return { sql, ...fixture, actor, stageJob };
}

function dailyReview(ownTag: string) {
  return {
    kind: "daily_totals" as const,
    weekStart,
    ourSide: "left" as const,
    confirmSides: true as const,
    left: { server: 1203, tag: ownTag, name: null },
    right: { server: 1236, tag: "TriV", name: null },
    day: 1,
    leftScore: "2241713380",
    rightScore: "2222858900",
    finalDay: true,
  };
}

function scoreInput(
  fixture: { allianceId: string; owner: { hqUserId: string } },
  seeded: Awaited<ReturnType<typeof seedVsReviewJob>>,
  requestId: string,
) {
  return {
    allianceId: fixture.allianceId,
    hqUserId: fixture.owner.hqUserId,
    jobId: seeded.jobId,
    parseSessionId: seeded.parseSessionId,
    recordedDate: monday,
    period: "daily" as const,
    requestId,
    rows: seeded.rows,
    expectedRevision: 0,
  };
}

function screenshotSubmission(
  evidenceVersion: number,
  ownTag: string,
): VsVideoMatchSubmission {
  return {
    evidenceVersion,
    expectedMatchupVersion: 0,
    expectedDayVersions: { [monday]: 0 },
    editOpponent: false,
    data: { source: "screenshot", imageVersion: 1, review: dailyReview(ownTag) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transport.resolve.mockResolvedValue(null);
  transport.validate.mockResolvedValue(undefined);
  transport.attemptSync.mockResolvedValue(null);
  transport.syncOpponent.mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("unexpected_external_request")),
  );
});

describe.skipIf(process.env.VS_VIDEO_EVIDENCE_DB_TEST !== "1")(
  "VS video match submission atomicity with guarded real DB",
  () => {
    afterAll(async () => {
      vi.unstubAllGlobals();
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("commits scores and a screenshot matchup in one transaction even when member sums disagree", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      const result = await commitVsVideoSubmission({
        access: seeded.access,
        score: scoreInput(f, seeded, randomUUID()),
        match: screenshotSubmission(evidence.version, f.tag),
      });
      const matchResult = result.matchResult as VsVideoMatchSaveResult;
      expect(matchResult).toMatchObject({
        weekStart,
        recordedDate: monday,
        period: "daily",
        imageVersion: 1,
        appliedImageVersion: 1,
        savedDays: [monday],
        replayed: false,
      });
      expect(
        await f.sql`SELECT id FROM vs_score_heads WHERE alliance_id = ${f.allianceId} AND source_job_id = ${seeded.jobId}`,
      ).toHaveLength(1);
      expect(
        (
          await f.sql`SELECT status FROM video_jobs WHERE id = ${seeded.jobId}`
        )[0].status,
      ).toBe("complete");
      expect(
        await f.sql`SELECT id FROM vs_matchups WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`,
      ).toHaveLength(1);
      const [head] =
        await f.sql`SELECT our_score::text, opponent_score::text, outcome, finality, hq_confirmed FROM vs_match_day_results WHERE alliance_id = ${f.allianceId} AND recorded_date = ${monday}`;
      expect(head).toMatchObject({
        our_score: "2241713380",
        opponent_score: "2222858900",
        outcome: "won",
        finality: "final",
        hq_confirmed: 1,
      });
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(1);
      expect(
        await f.sql`SELECT id FROM vs_score_sync_scopes WHERE alliance_id = ${f.allianceId}`,
      ).toHaveLength(0);
    }, 30000);

    it("rolls member rows back when the matchup expected version is stale", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      await expect(
        commitVsVideoSubmission({
          access: seeded.access,
          score: scoreInput(f, seeded, randomUUID()),
          match: {
            ...screenshotSubmission(evidence.version, f.tag),
            expectedMatchupVersion: 99,
          },
        }),
      ).rejects.toMatchObject({ code: "stale" });
      expect(
        await f.sql`SELECT id FROM vs_score_heads WHERE alliance_id = ${f.allianceId} AND source_job_id = ${seeded.jobId}`,
      ).toHaveLength(0);
      expect(
        (
          await f.sql`SELECT status FROM video_jobs WHERE id = ${seeded.jobId}`
        )[0].status,
      ).toBe("review");
      expect(
        await f.sql`SELECT id FROM vs_matchups WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`,
      ).toHaveLength(0);
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(0);
    }, 30000);

    it("commits at most one match receipt and score revision for duplicate concurrent requests", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      const requestId = randomUUID();
      const call = () =>
        commitVsVideoSubmission({
          access: seeded.access,
          score: scoreInput(f, seeded, requestId),
          match: screenshotSubmission(evidence.version, f.tag),
        });
      const [a, b] = await Promise.all([call(), call()]);
      expect(a.batchId).toBe(b.batchId);
      expect(a.vsRevision).toBe(b.vsRevision);
      expect(
        [a.matchResult.replayed, b.matchResult.replayed].sort(),
      ).toEqual([false, true]);
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(1);
      expect(
        await f.sql`SELECT id FROM vs_score_revisions WHERE alliance_id = ${f.allianceId}`,
      ).toHaveLength(1);
      expect(
        await f.sql`SELECT id FROM vs_matchups WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`,
      ).toHaveLength(1);
    }, 30000);

    it("rejects a second different request on stale evidence while the first winner stays intact", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      const winner = await commitVsVideoSubmission({
        access: seeded.access,
        score: scoreInput(f, seeded, randomUUID()),
        match: screenshotSubmission(evidence.version, f.tag),
      });
      expect(winner.matchResult.replayed).toBe(false);
      const secondScore = {
        ...scoreInput(f, seeded, randomUUID()),
        expectedRevision: winner.vsRevision,
        rows: [{ ...seeded.rows[0], score: "9" }],
      };
      await expect(
        commitVsVideoSubmission({
          access: seeded.access,
          score: secondScore,
          match: screenshotSubmission(evidence.version, f.tag),
        }),
      ).rejects.toMatchObject({ code: "stale" });
      const [head] =
        await f.sql`SELECT score::text FROM vs_score_heads WHERE alliance_id = ${f.allianceId} AND source_job_id = ${seeded.jobId}`;
      expect(head.score).toBe("7");
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(1);
      expect(
        await f.sql`SELECT id FROM vs_matchups WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`,
      ).toHaveLength(1);
      expect(
        (
          await f.sql`SELECT status FROM video_jobs WHERE id = ${seeded.jobId}`
        )[0].status,
      ).toBe("complete");
    }, 30000);

    it("cannot partially save member rows when the manual match metadata fails", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      await expect(
        commitVsVideoSubmission({
          access: seeded.access,
          score: scoreInput(f, seeded, randomUUID()),
          match: {
            evidenceVersion: evidence.version,
            expectedMatchupVersion: 0,
            expectedDayVersions: {},
            editOpponent: false,
            data: { source: "manual" },
          },
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(
        await f.sql`SELECT id FROM vs_score_heads WHERE alliance_id = ${f.allianceId} AND source_job_id = ${seeded.jobId}`,
      ).toHaveLength(0);
      expect(
        (
          await f.sql`SELECT status FROM video_jobs WHERE id = ${seeded.jobId}`
        )[0].status,
      ).toBe("review");
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(0);
    }, 30000);

    it("saves a manual opponent score through the match-only path without inventing our totals", async () => {
      const f = await setup();
      const seeded = await f.stageJob(7);
      const evidence = await stageReadyEvidence(f.sql, {
        allianceId: f.allianceId,
        jobId: seeded.jobId,
        sessionId: f.owner.sessionId,
        recordedDate: monday,
      });
      const response = await saveVsVideoMatchOnly(seeded.access, {
        requestId: randomUUID(),
        submission: {
          evidenceVersion: evidence.version,
          expectedMatchupVersion: 0,
          expectedDayVersions: {},
          editOpponent: false,
          data: { source: "manual", opponentScore: "2222858900" },
        },
      });
      expect(response).toBeTruthy();
      const [matchup] =
        await f.sql`SELECT id, week_outcome, opponent_daily_scores FROM vs_matchups WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`;
      expect(matchup.week_outcome).toBe("pending");
      expect(matchup.opponent_daily_scores[0]).toBe("2222858900");
      expect(
        await f.sql`SELECT id FROM vs_match_day_results WHERE alliance_id = ${f.allianceId} AND matchup_id = ${matchup.id}`,
      ).toHaveLength(0);
      expect(
        await f.sql`SELECT request_id FROM video_vs_evidence_receipts WHERE scope_key = ${evidence.scopeKey} AND alliance_id = ${f.allianceId}`,
      ).toHaveLength(1);
      expect(transport.attemptSync).toHaveBeenCalledTimes(1);
      expect(
        (
          await f.sql`SELECT status FROM video_jobs WHERE id = ${seeded.jobId}`
        )[0].status,
      ).toBe("review");
    }, 30000);
  },
);
