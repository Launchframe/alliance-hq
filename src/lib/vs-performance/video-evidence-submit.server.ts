import "server-only";

import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { vsPerformanceDayNumberForDate } from "@/lib/video/vs-recorded-date.shared";
import { applyVsCaptureReviewTx } from "@/lib/vs-performance/vs-capture.server";
import { normalizedVsCaptureTag } from "@/lib/vs-performance/vs-capture.shared";
import {
  saveVsMatchupIdentityTx,
} from "@/lib/vs-performance/match-results.server";
import {
  loadVsMatchupRowForUpdate,
} from "@/lib/vs-performance/match-results.repository.server";
import {
  vsVideoContextSchema,
  vsVideoMatchSubmissionSchema,
  vsVideoScreenshotContextMatches,
  vsVideoWeekStart,
  type VsVideoContext,
  type VsVideoEvidenceResponse,
  type VsVideoMatchSubmission,
} from "@/lib/vs-performance/video-evidence.shared";
import {
  loadVsVideoEvidence,
  loadVsVideoEvidenceRow,
  vsVideoScopeKey,
  type VsVideoAccess,
} from "@/lib/vs-performance/video-evidence.server";
import { assertVsActorContextTx, vsScope } from "@/lib/vs-performance/vs-scope.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import {
  commitReviewedVsScoresTx,
  type VsScoreCommitInput,
  type VsTransaction,
} from "@/lib/vs-scores/repository.server";

export type VsVideoMatchSaveResult = {
  weekStart: string;
  recordedDate: string;
  period: "daily" | "weekly";
  imageVersion: number;
  appliedImageVersion: number | null;
  savedDays: string[];
  replayed: boolean;
};

const requestIdSchema = z.string().min(8).max(100);

function stale(): VsPerformanceError {
  return new VsPerformanceError("stale", 409);
}

function invalid(): VsPerformanceError {
  return new VsPerformanceError("invalid", 400);
}

function canonicalSubmission(input: VsVideoMatchSubmission) {
  return {
    ...input,
    expectedDayVersions: Object.fromEntries(
      Object.entries(input.expectedDayVersions).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  };
}

export async function applyVsVideoMatchSubmissionTx(
  tx: VsTransaction,
  access: VsVideoAccess,
  context: VsVideoContext,
  input: VsVideoMatchSubmission,
  requestId: string,
): Promise<VsVideoMatchSaveResult> {
  requestIdSchema.parse(requestId);
  const weekStart = vsVideoWeekStart(context);
  const scope = vsScope(access.actor, weekStart);
  await lockAllianceAvailability(tx, access.actor.allianceId);
  await assertVsActorContextTx(tx, access.actor);

  const [job] = await tx
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, access.job.id))
    .for("update")
    .limit(1);
  if (
    !job ||
    vsVideoScopeKey(job) !== access.scopeKey ||
    (job.scoreTarget ?? job.category) !== "vs-performance" ||
    !["review", "complete"].includes(job.status)
  ) {
    throw stale();
  }
  const [alliance] = await tx
    .select({
      id: schema.alliances.id,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, access.actor.allianceId))
    .limit(1);
  if (
    !alliance ||
    !job.allianceId ||
    ![alliance.id, alliance.ashedAllianceId].includes(job.allianceId)
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  if (job.groupId) {
    const [group] = await tx
      .select({
        selectedJobId: schema.videoUploadGroups.selectedJobId,
        primaryJobId: schema.videoUploadGroups.primaryJobId,
      })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);
    const selected = group?.selectedJobId ?? group?.primaryJobId ?? null;
    if (selected != null && selected !== access.job.id) throw stale();
  }

  const [evidence] = await tx
    .select()
    .from(schema.videoVsEvidence)
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
      ),
    )
    .for("update")
    .limit(1);
  if (!evidence) throw stale();
  if (
    input.data.source === "screenshot" &&
    input.data.opponentScore != null &&
    (input.data.review.kind !== "weekly_overview" ||
      context.period !== "daily")
  ) {
    throw invalid();
  }
  if (
    evidence.recordedDate !== context.recordedDate ||
    evidence.period !== context.period
  ) {
    throw stale();
  }

  const canonical = canonicalSubmission(input);
  const digest = createHash("sha256")
    .update(
      JSON.stringify([context.recordedDate, context.period, canonical]),
    )
    .digest("hex");
  const [receipt] = await tx
    .select()
    .from(schema.videoVsEvidenceReceipts)
    .where(
      and(
        eq(schema.videoVsEvidenceReceipts.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidenceReceipts.allianceId, access.actor.allianceId),
        eq(schema.videoVsEvidenceReceipts.requestId, requestId),
      ),
    )
    .limit(1);
  if (receipt) {
    const saved = receipt.result as VsVideoMatchSaveResult;
    if (
      receipt.digest !== digest ||
      saved.imageVersion !== evidence.imageVersion ||
      saved.recordedDate !== context.recordedDate ||
      saved.period !== context.period
    ) {
      throw stale();
    }
    return { ...saved, replayed: true };
  }
  if (evidence.version !== input.evidenceVersion) throw stale();

  const matchup = await loadVsMatchupRowForUpdate(
    tx,
    access.actor.allianceId,
    weekStart,
  );
  if ((matchup?.version ?? 0) !== input.expectedMatchupVersion) throw stale();

  let savedDays: string[] = [];
  let appliedImageVersion = evidence.appliedImageVersion;
  let fullyApplied = false;

  if (input.data.source === "screenshot") {
    const review = input.data.review;
    if (
      evidence.status !== "ready" ||
      !evidence.storageKey ||
      !evidence.imageSha256 ||
      !evidence.candidate
    ) {
      throw invalid();
    }
    if (evidence.imageVersion !== input.data.imageVersion) throw stale();
    if (evidence.candidate.kind !== review.kind) throw invalid();
    if (!vsVideoScreenshotContextMatches(context, review)) throw invalid();
    const foe = review.ourSide === "left" ? review.right : review.left;
    if (!input.editOpponent && matchup) {
      const nameMismatch =
        foe.name != null &&
        matchup.opponentName != null &&
        foe.name !== matchup.opponentName;
      const tagMismatch =
        foe.tag != null &&
        matchup.opponentTag != null &&
        normalizedVsCaptureTag(foe.tag) !==
          normalizedVsCaptureTag(matchup.opponentTag);
      const serverMismatch =
        foe.server != null &&
        matchup.opponentServer != null &&
        foe.server !== matchup.opponentServer;
      if (nameMismatch || tagMismatch || serverMismatch) {
        throw new VsPerformanceError("capture_invalid", 409);
      }
    }
    const applied = await applyVsCaptureReviewTx(tx, access.actor, review, {
      expectedMatchupVersion: input.expectedMatchupVersion,
      expectedDayVersions: input.expectedDayVersions,
      requestId,
      scope,
      sourceRef: `video:${access.scopeKey}:${evidence.imageVersion}`,
      allowOpponentIdentityChange: input.editOpponent,
    });
    if (input.data.opponentScore != null) {
      if (review.kind !== "weekly_overview" || context.period !== "daily") {
        throw invalid();
      }
      const current = await loadVsMatchupRowForUpdate(
        tx,
        access.actor.allianceId,
        weekStart,
      );
      const day = vsPerformanceDayNumberForDate(context.recordedDate);
      if (day == null) throw invalid();
      if ((current?.opponentDailyScores?.[day - 1] ?? null) !== input.data.opponentScore) {
        await saveVsMatchupIdentityTx(tx, access.actor, {
          weekStart,
          opponentName: current?.opponentName ?? null,
          opponentTag: current?.opponentTag ?? null,
          opponentServer: current?.opponentServer ?? null,
          opponentScores: [{ day, score: input.data.opponentScore }],
          expectedVersion: current?.version ?? 0,
          scope,
        });
      }
    }
    savedDays = applied.savedDays;
    fullyApplied =
      review.kind === "weekly_overview" || review.finalDay === true;
    if (fullyApplied) appliedImageVersion = evidence.imageVersion;
  } else {
    const supplied = input.data;
    const opp = supplied.opponent;
    const hasMeaningfulField =
      supplied.opponentScore != null ||
      (opp !== undefined &&
        (opp.name !== undefined ||
          opp.tag !== undefined ||
          opp.server !== undefined));
    if (!hasMeaningfulField) throw invalid();
    if (context.period === "weekly" && supplied.opponentScore != null) {
      throw invalid();
    }
    const opponentName =
      supplied.opponent?.name !== undefined
        ? supplied.opponent.name
        : (matchup?.opponentName ?? null);
    const opponentTag =
      supplied.opponent?.tag !== undefined
        ? supplied.opponent.tag
        : (matchup?.opponentTag ?? null);
    const opponentServer =
      supplied.opponent?.server !== undefined
        ? supplied.opponent.server
        : (matchup?.opponentServer ?? null);
    if (!input.editOpponent && matchup) {
      const nameChanged =
        supplied.opponent?.name !== undefined &&
        matchup.opponentName != null &&
        supplied.opponent.name !== matchup.opponentName;
      const newTag = supplied.opponent?.tag;
      const tagChanged =
        newTag !== undefined &&
        matchup.opponentTag != null &&
        normalizedVsCaptureTag(newTag ?? "") !==
          normalizedVsCaptureTag(matchup.opponentTag);
      const serverChanged =
        supplied.opponent?.server !== undefined &&
        matchup.opponentServer != null &&
        supplied.opponent.server !== matchup.opponentServer;
      if (nameChanged || tagChanged || serverChanged) {
        throw new VsPerformanceError("capture_invalid", 409);
      }
    }
    let opponentScores: { day: number; score: string | null }[] | undefined;
    if (supplied.opponentScore != null) {
      const day = vsPerformanceDayNumberForDate(context.recordedDate);
      if (day == null) throw invalid();
      opponentScores =
        (matchup?.opponentDailyScores?.[day - 1] ?? null) ===
        supplied.opponentScore
          ? []
          : [{ day, score: supplied.opponentScore }];
    }
    await saveVsMatchupIdentityTx(tx, access.actor, {
      weekStart,
      opponentName,
      opponentTag,
      opponentServer,
      ...(opponentScores !== undefined ? { opponentScores } : {}),
      expectedVersion: input.expectedMatchupVersion,
      scope,
    });
    fullyApplied = true;
  }

  const now = new Date();
  const patch: Record<string, unknown> = {
    version: sql`${schema.videoVsEvidence.version} + 1`,
    updatedByHqUserId: access.actor.hqUserId,
    updatedAt: now,
  };
  if (fullyApplied) {
    patch.draft = null;
    patch.appliedImageVersion = appliedImageVersion;
  }
  await tx
    .update(schema.videoVsEvidence)
    .set(patch)
    .where(
      and(
        eq(schema.videoVsEvidence.scopeKey, access.scopeKey),
        eq(schema.videoVsEvidence.allianceId, access.actor.allianceId),
        eq(schema.videoVsEvidence.version, evidence.version),
      ),
    );
  const result: VsVideoMatchSaveResult = {
    weekStart,
    recordedDate: context.recordedDate,
    period: context.period,
    imageVersion: evidence.imageVersion,
    appliedImageVersion,
    savedDays,
    replayed: false,
  };
  await tx.insert(schema.videoVsEvidenceReceipts).values({
    scopeKey: access.scopeKey,
    allianceId: access.actor.allianceId,
    requestId,
    digest,
    result,
  });
  await tx.insert(schema.auditLog).values({
    id: nanoid(),
    sessionId: access.actor.sessionId,
    allianceId: access.actor.allianceId,
    hqUserId: access.actor.hqUserId,
    action: "vs.video_match_submit",
    severity: "update",
    resourceType: "video_job",
    resourceId: job.id,
    metadata: {
      permission: "trains:write",
      requestId,
      jobId: job.id,
      weekStart,
      recordedDate: context.recordedDate,
      period: context.period,
      source: input.data.source,
      imageVersion: evidence.imageVersion,
      imageSha256: evidence.imageSha256,
      submission: canonical,
    },
  });
  return result;
}

export async function commitVsVideoSubmission(input: {
  access: VsVideoAccess;
  score: VsScoreCommitInput;
  match: unknown;
}): Promise<
  Awaited<ReturnType<typeof commitReviewedVsScoresTx>> & {
    matchResult: VsVideoMatchSaveResult;
  }
> {
  const { access } = input;
  const match = vsVideoMatchSubmissionSchema.parse(input.match);
  if (
    input.score.allianceId !== access.actor.allianceId ||
    input.score.hqUserId !== access.actor.hqUserId ||
    input.score.jobId !== access.job.id
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  const [scoresAllowed, reviewAllowed] = await Promise.all([
    sessionHasPermissionForAlliance(
      access.actor.sessionId,
      access.actor.allianceId,
      "scores:write",
    ),
    sessionHasPermissionForAlliance(
      access.actor.sessionId,
      access.actor.allianceId,
      "trains:write",
    ),
  ]);
  if (!scoresAllowed || !reviewAllowed) {
    throw new VsPerformanceError("forbidden", 403);
  }
  const canonical = canonicalSubmission(match);
  const context = vsVideoContextSchema.parse({
    recordedDate: input.score.recordedDate,
    period: input.score.period,
  });
  const requestId = input.score.requestId;
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, access.actor.allianceId);
    await assertVsActorContextTx(tx, access.actor);
    const scoreResult = await commitReviewedVsScoresTx(tx, {
      ...input.score,
      additionalDigest: canonical,
    });
    const matchResult = await applyVsVideoMatchSubmissionTx(
      tx,
      access,
      context,
      match,
      requestId,
    );
    return { ...scoreResult, matchResult };
  });
}

const saveBodySchema = z
  .object({
    requestId: requestIdSchema,
    submission: vsVideoMatchSubmissionSchema,
  })
  .strict();

export async function saveVsVideoMatchOnly(
  access: VsVideoAccess,
  input: unknown,
): Promise<VsVideoEvidenceResponse> {
  const body = saveBodySchema.parse(input);
  if (
    !(await sessionHasPermissionForAlliance(
      access.actor.sessionId,
      access.actor.allianceId,
      "trains:write",
    ))
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  const row = await loadVsVideoEvidenceRow(access);
  if (!row) throw stale();
  const context: VsVideoContext = {
    recordedDate: row.recordedDate,
    period: row.period,
  };
  const result = await getDb().transaction(async (tx) =>
    applyVsVideoMatchSubmissionTx(
      tx,
      access,
      context,
      body.submission,
      body.requestId,
    ),
  );
  if (!result.replayed) {
    const { attemptVsOpponentSync } = await import(
      "@/lib/vs-performance/matchup-sync.server"
    );
    await attemptVsOpponentSync(access.actor, result.weekStart).catch(
      () => undefined,
    );
  }
  return loadVsVideoEvidence(access);
}
