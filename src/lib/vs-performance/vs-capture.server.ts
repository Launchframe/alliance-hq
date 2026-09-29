import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  buildVsCaptureCommit,
  mergeVsCaptureResults,
  normalizedVsCaptureTag,
  vsCaptureReviewSchema,
  type VsCaptureCandidate,
  type VsCaptureKind,
  type VsCaptureReview,
} from "@/lib/vs-performance/vs-capture.shared";
import {
  assertVsActorCurrent,
  assertVsActorContextTx,
  assertVsScope,
  vsContextScope,
} from "@/lib/vs-performance/vs-scope.server";
import {
  loadVsMatchDayResultForUpdate,
  loadVsMatchupRowForUpdate,
  markVsOpponentFieldsDirty,
  upsertVsMatchup,
} from "@/lib/vs-performance/match-results.repository.server";
import { saveVsMatchDayResultTx } from "@/lib/vs-performance/match-results.server";
import type { VsOpponentField } from "@/lib/vs-performance/opponent-info.shared";
import {
  VsPerformanceError,
  vsDatesForWeek,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import { loadVsPerformanceWeek } from "@/lib/vs-performance/weekly-plan.server";
import type {
  VsActor,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

const REVIEW_TTL_MS = 30 * 60 * 1000;

function captureInvalid(): VsPerformanceError {
  return new VsPerformanceError("capture_invalid", 400);
}

export async function stageVsCaptureReview(input: {
  actor: VsActor;
  kind: VsCaptureKind;
  weekStart: string;
  scope: string;
  image: Buffer;
  candidate: VsCaptureCandidate;
}): Promise<{
  reviewId: string;
  version: number;
  candidate: VsCaptureCandidate;
  expiresAt: string;
  contextScope: string;
}> {
  const { actor, kind, image, candidate } = input;
  const weekStart = vsWeekStartSchema.parse(input.weekStart);
  assertVsScope(actor, weekStart, input.scope);
  if (candidate.kind !== kind) throw captureInvalid();
  const imageSha256 = createHash("sha256").update(image).digest("hex");
  await assertVsActorCurrent(actor);
  const expiresAt = new Date(Date.now() + REVIEW_TTL_MS);
  const reviewId = nanoid();
  await getDb()
    .insert(schema.vsCaptureReviews)
    .values({
      id: reviewId,
      allianceId: actor.allianceId,
      createdByHqUserId: actor.hqUserId,
      kind,
      imageSha256,
      candidate,
      expiresAt,
    });
  await writeTrainsOfficerAudit({
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.capture_stage",
    severity: "update",
    resourceType: "vs_capture_review",
    resourceId: reviewId,
    metadata: {
      weekStart,
      reviewId,
      kind,
      imageSha256,
    },
  });
  return {
    reviewId,
    version: 1,
    candidate,
    expiresAt: expiresAt.toISOString(),
    contextScope: vsContextScope(actor),
  };
}

const commitBodySchema = z
  .object({
    review: z.unknown(),
    expectedReviewVersion: z.number().int().min(1),
    expectedMatchupVersion: z.number().int().min(0),
    expectedDayVersions: z.record(z.string(), z.number().int().min(0)),
    requestId: z.string().min(1).max(120),
    scope: z.string().min(1).max(200),
  })
  .strict();

export async function commitVsCaptureReview(
  actor: VsActor,
  reviewId: string,
  input: unknown,
): Promise<VsWeekPayload> {
  const body = commitBodySchema.parse(input);
  const review = vsCaptureReviewSchema.parse(body.review) as VsCaptureReview;
  const weekStart = vsWeekStartSchema.parse(review.weekStart);
  assertVsScope(actor, weekStart, body.scope);
  await assertVsActorCurrent(actor);
  const today = getServerCalendarDate();
  const weekDates = vsDatesForWeek(weekStart);
  const bodyHash = createHash("sha256")
    .update(JSON.stringify([reviewId, review, body.expectedReviewVersion, body.expectedMatchupVersion, Object.entries(body.expectedDayVersions).sort(([a], [b]) => a.localeCompare(b)), body.requestId, body.scope]))
    .digest("hex");
  const ourSideInfo = review.ourSide === "left" ? review.left : review.right;
  const foeSideInfo = review.ourSide === "left" ? review.right : review.left;
  const commit = buildVsCaptureCommit(review, today);

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    await assertVsActorContextTx(tx, actor);
    const [row] = await tx
      .select()
      .from(schema.vsCaptureReviews)
      .where(
        and(
          eq(schema.vsCaptureReviews.id, reviewId),
          eq(schema.vsCaptureReviews.allianceId, actor.allianceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw captureInvalid();
    if (row.createdByHqUserId !== actor.hqUserId) throw captureInvalid();
    if (row.status === "complete") {
      if (
        row.completedRequestId === body.requestId &&
        row.completedBodyHash === bodyHash &&
        row.completedResult &&
        typeof (row.completedResult as { weekStart?: unknown }).weekStart ===
          "string"
      ) {
        return {
          replayed: true,
          weekStart: (row.completedResult as { weekStart: string }).weekStart,
          savedDays:
            (row.completedResult as { savedDays?: string[] }).savedDays ?? [],
        };
      }
      throw new VsPerformanceError("stale", 409);
    }
    if (
      row.version !== body.expectedReviewVersion ||
      row.expiresAt <= new Date() ||
      row.kind !== review.kind
    ) {
      throw captureInvalid();
    }

    const [allianceRow] = await tx
      .select({
        tag: schema.alliances.tag,
        gameServerNumber: schema.alliances.gameServerNumber,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, actor.allianceId))
      .limit(1);
    if (
      (allianceRow?.gameServerNumber != null &&
        ((review.kind === "weekly_overview" && ourSideInfo.server == null) ||
          (ourSideInfo.server != null &&
            ourSideInfo.server !== allianceRow.gameServerNumber))) ||
      (allianceRow?.tag != null &&
        (ourSideInfo.tag == null ||
          normalizedVsCaptureTag(ourSideInfo.tag) !==
            normalizedVsCaptureTag(allianceRow.tag)))
    ) {
      throw captureInvalid();
    }

    const matchup = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      weekStart,
    );
    if ((matchup?.version ?? 0) !== body.expectedMatchupVersion) {
      throw new VsPerformanceError("stale", 409);
    }
    if (
      matchup &&
      ((matchup.opponentTag != null &&
        (foeSideInfo.tag == null ||
          normalizedVsCaptureTag(matchup.opponentTag) !==
            normalizedVsCaptureTag(foeSideInfo.tag))) ||
        (matchup.opponentServer != null &&
          foeSideInfo.server != null &&
          matchup.opponentServer !== foeSideInfo.server))
    ) {
      throw captureInvalid();
    }

    const heads = new Map<
      string,
      Awaited<ReturnType<typeof loadVsMatchDayResultForUpdate>>
    >();
    if (matchup) {
      for (const date of weekDates) {
        heads.set(
          date,
          await loadVsMatchDayResultForUpdate(
            tx,
            matchup.id,
            date,
            actor.allianceId,
          ),
        );
      }
    }

    const merged = mergeVsCaptureResults(
      commit,
      [...heads.values()]
        .filter((head): head is NonNullable<typeof head> => head != null)
        .map((head) => ({
          recordedDate: head.recordedDate,
          totals:
            head.ourScore != null && head.opponentScore != null
              ? {
                  ourScore: BigInt(head.ourScore).toString(),
                  opponentScore: BigInt(head.opponentScore).toString(),
                }
              : null,
          outcome: head.outcome,
          finality: head.finality,
        })),
      today,
    );

    const requestId = `capture:${reviewId}:${body.requestId}`;
    const savedDays: string[] = [];
    const dirtyFields = new Set<VsOpponentField>();
    let matchupId = matchup?.id ?? null;

    const ensureMatchup = async () => {
      if (matchupId) return;
      const created = await upsertVsMatchup(tx, {
        allianceId: actor.allianceId,
        weekStart,
        identitySource: "hq_manual",
        expectedVersion: 0,
        actorHqUserId: actor.hqUserId,
      });
      matchupId = created.id;
    };

    for (const day of merged.days) {
      const dayIndex = weekDates.indexOf(day.recordedDate);
      if (dayIndex < 0 || dayIndex > 5) throw captureInvalid();
      const head = heads.get(day.recordedDate) ?? null;
      const expected = body.expectedDayVersions[day.recordedDate];
      if (expected === undefined) throw captureInvalid();
      if (expected !== (head?.version ?? 0)) {
        throw new VsPerformanceError("stale", 409);
      }
      await ensureMatchup();
      const inner = await saveVsMatchDayResultTx(tx, {
        actor,
        matchupId: matchupId!,
        recordedDate: day.recordedDate,
        expectedVersion: expected,
        requestId: `${requestId}:${dayIndex + 1}`,
        scope: body.scope,
        normalized: {
          finality: "final",
          totals: day.totals,
          outcome: day.outcome,
        },
        hqConfirmed: true,
        evidence: {
          kind: "reviewed_upload",
          reviewCaptureId: reviewId,
          sourceRef: reviewId,
        },
        markOpponentDirty: day.totals != null,
      });
      if (!inner.replayed) savedDays.push(day.recordedDate);
    }

    const metaPatch: Record<string, unknown> = {};
    const metaFields: VsOpponentField[] = [];
    if (foeSideInfo.tag != null) {
      metaPatch.opponentTag = foeSideInfo.tag;
      metaFields.push("opponentTag");
    }
    if (foeSideInfo.server != null) {
      metaPatch.opponentServer = foeSideInfo.server;
      metaFields.push("opponentServer");
    }
    if (foeSideInfo.name != null) {
      metaPatch.opponentName = foeSideInfo.name;
      metaFields.push("opponentName");
    }
    if (merged.weekOutcome != null) {
      metaPatch.weekOutcome = merged.weekOutcome;
      metaFields.push("weekOutcome");
    }
    if (merged.weeklyPoints) {
      metaPatch.reportedOurPoints = merged.weeklyPoints.ours;
      metaPatch.reportedOpponentPoints = merged.weeklyPoints.theirs;
      metaPatch.reportedPointsAt = new Date();
    }
    if (Object.keys(metaPatch).length > 0) {
      await ensureMatchup();
      const current = await loadVsMatchupRowForUpdate(
        tx,
        actor.allianceId,
        weekStart,
      );
      const owned = new Set<string>(current?.opponentInfoOwnedFields ?? []);
      for (const field of metaFields) owned.add(field);
      await tx
        .update(schema.vsMatchups)
        .set({
          ...metaPatch,
          opponentInfoOwnedFields: [...owned] as VsOpponentField[],
          version: (current?.version ?? 0) + 1,
          updatedByHqUserId: actor.hqUserId,
          updatedAt: new Date(),
        })
        .where(eq(schema.vsMatchups.id, matchupId!));
      for (const field of metaFields) dirtyFields.add(field);
    }

    if (dirtyFields.size > 0 && matchupId) {
      await markVsOpponentFieldsDirty(
        tx,
        matchupId,
        actor.allianceId,
        [...dirtyFields],
      );
    }

    if (merged.days.length === 0 && Object.keys(metaPatch).length === 0) {
      throw captureInvalid();
    }

    await tx
      .update(schema.vsCaptureReviews)
      .set({
        status: "complete",
        version: body.expectedReviewVersion + 1,
        completedRequestId: body.requestId,
        completedBodyHash: bodyHash,
        completedResult: { weekStart, savedDays },
      })
      .where(eq(schema.vsCaptureReviews.id, reviewId));
    return { replayed: false, weekStart, savedDays };
  });

  if (!result.replayed) {
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.capture_commit",
      severity: "update",
      resourceType: "vs_capture_review",
      resourceId: reviewId,
      metadata: {
        weekStart: result.weekStart,
        reviewId,
        reviewHash: bodyHash,
        savedDays: result.savedDays,
        kind: review.kind,
        reviewed: review,
      },
    });
    const { attemptVsOpponentSync } = await import("@/lib/vs-performance/matchup-sync.server");
    await attemptVsOpponentSync(actor, result.weekStart).catch(() => undefined);
  }
  return loadVsPerformanceWeek(actor.sessionId, result.weekStart, actor);
}
