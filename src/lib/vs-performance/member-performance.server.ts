import "server-only";

import { and, desc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { VS_COMPLIANCE_MANAGE_PERMISSION, VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { loadComplianceStateVersion, prepareExternalEvidence, resolveComplianceEvidence } from "@/lib/vs-compliance/evidence.server";
import { policyForVsWeek } from "@/lib/vs-compliance/policy.shared";
import { computeComplianceRows } from "@/lib/vs-compliance/repository.server";
import { VsComplianceError, type VsComplianceEvaluation, type VsComplianceWeek } from "@/lib/vs-compliance/types.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { buildVsMemberRow, parseVsMemberWeekQuery, queryVsMemberRows, summarizeVsMemberRows, vsMemberDisplayThreshold } from "./member-performance.shared";
import type { VsMemberDay, VsMemberRow } from "./member-performance.shared";
import type { VsMemberDetailResponse, VsMemberDetailWeek, VsMemberHistoryWeek, VsMemberRevisionsResponse } from "./member-performance-view.shared";

export async function loadVsMemberWeek(sessionId: string, allianceId: string, rawQuery: Record<string, string | undefined>) {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const now = new Date();
  const query = parseVsMemberWeekQuery(rawQuery, now);
  const weekEnding = addCalendarDays(query.weekStart, 6);
  const lastClosed = lastClosedVsWeek(now);
  const live = weekEnding > lastClosed;
  const weekClosed = Date.parse(`${weekEnding}T02:00:00.000Z`) <= now.getTime();
  let canManage = false;
  try { await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION); canManage = true; }
  catch (error) { if (!(error instanceof VsComplianceError) || error.code !== "forbidden") throw error; }

  const external = await prepareExternalEvidence(allianceId, [weekEnding]);
  const [result, inputVersion, persisted] = await Promise.all([
    computeComplianceRows(getDb(), allianceId, [weekEnding], external, { now }),
    loadComplianceStateVersion(allianceId),
    getDb().select({ memberId: schema.vsComplianceEvaluations.memberId }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))),
  ]);
  const { facts } = result;
  const policy = policyForVsWeek(facts.policies, weekEnding);
  const evaluatedIds = new Set(persisted.map((row) => row.memberId));
  const weekDates = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));

  const members = facts.members.filter((roster) => {
    if (roster.member.active) return true;
    if (live) return false;
    if (evaluatedIds.has(roster.memberId)) return true;
    return facts.heads.some((head) => head.memberId === roster.memberId && (head.recordedDate === weekEnding || weekDates.includes(head.recordedDate)));
  });

  const allRows = members.map((roster) => {
    const row = result.rows.find((candidate) => candidate.memberId === roster.memberId && candidate.weekEnding === weekEnding);
    if (!row) throw new VsComplianceError("failed", 500);
    const resolved = resolveComplianceEvidence(facts, roster.memberId, weekEnding, external, row.remoteEvidence, row.remoteVerifiedAt);
    return buildVsMemberRow({
      memberId: roster.memberId,
      name: roster.name,
      member: roster.member,
      days: resolved.daily,
      evaluation: row.evaluation,
      policy,
      weekClosed,
      reportedTotal: resolved.evidence.source === "weekly" ? resolved.evidence.score : null,
      now: now.getTime(),
    });
  });

  const outstanding = result.rows.filter((row) => row.weekEnding !== weekEnding && (row.evaluation.recommendation.kind !== "none" || row.evaluation.correctionReview));
  const { rows, total } = queryVsMemberRows(allRows, query);
  const { summary, attention } = summarizeVsMemberRows(allRows);
  return {
    weekStart: query.weekStart,
    weekEnding,
    live,
    inputVersion,
    policy: {
      modelVersion: policy?.modelVersion ?? null,
      dailyThreshold: vsMemberDisplayThreshold(policy),
      allowedMissedDays: policy?.modelVersion === 2 ? policy.allowedMissedDays : null,
      enabled: policy?.enabled ?? false,
    },
    source: { native: external.native, verifiedAt: !external.native && external.verifiedAt && external.weeks.has(weekEnding) ? external.verifiedAt.toISOString() : null, stale: !external.native && !(external.verifiedAt && external.weeks.has(weekEnding)) },
    summary,
    attention,
    outstanding: { count: new Set(outstanding.map((row) => row.memberId)).size, weeks: [...new Set(outstanding.map((row) => row.weekEnding))].sort() },
    rows, total, page: query.page, pageSize: query.pageSize, canManage,
  };
}

async function assertVsMemberScope(db: ReturnType<typeof getDb>, allianceId: string, memberId: string, weekEnding: string) {
  const [persisted] = await db.select({ id: schema.vsComplianceEvaluations.id, memberName: schema.vsComplianceEvaluations.memberName }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))).limit(1);
  if (persisted) return persisted;
  const [roster] = await db.select({ id: schema.allianceMembers.id, memberName: schema.allianceMembers.currentName }).from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.ashedMemberId, memberId))).limit(1);
  if (!roster) throw new VsComplianceError("not_found", 404);
  return roster;
}

function vsMemberHistoryStatus(evaluation: VsComplianceEvaluation): VsMemberRow["status"] {
  if (evaluation.outcome === "passed") return "meeting";
  if (evaluation.outcome === "excused") return "excused";
  if (evaluation.outcome === "waived") return "waived";
  if (evaluation.outcome === "pending_data") return "needs_evidence";
  if (evaluation.outcome === "not_eligible") return "not_eligible";
  if (evaluation.modelVersion === 2) {
    const assessed = (evaluation.days ?? []).filter(day => day.assessment === "met" || day.assessment === "missed");
    const verifiedZero = assessed.length > 0 && evaluation.counts?.unknown === 0 && assessed.every(day => day.assessment === "missed" && day.score === 0);
    return verifiedZero ? "zero" : "below";
  }
  return evaluation.score === 0 ? "zero" : "below";
}

async function mapVsMemberHistoryPage(db: ReturnType<typeof getDb>, allianceId: string, memberId: string, history: Array<{ id: string; weekEnding: string; evaluation: VsComplianceEvaluation }>) {
  const visibleWeeks = history.slice(0, 12);
  const statusByActionId = new Map<string, NonNullable<VsMemberHistoryWeek["settled"]>["syncStatus"]>();
  if (visibleWeeks.length > 0) {
    const jobRows = await db.select({ eventId: schema.vsComplianceActions.eventId, actionId: schema.vsComplianceActions.id, status: schema.vsComplianceSyncJobs.status }).from(schema.vsComplianceActions).leftJoin(schema.vsComplianceSyncJobs, and(eq(schema.vsComplianceSyncJobs.actionId, schema.vsComplianceActions.id), eq(schema.vsComplianceSyncJobs.allianceId, allianceId))).where(and(eq(schema.vsComplianceActions.allianceId, allianceId), eq(schema.vsComplianceActions.memberId, memberId), inArray(schema.vsComplianceActions.eventId, visibleWeeks.map(week => week.id)), inArray(schema.vsComplianceActions.kind, ["demote", "remove"])));
    for (const job of jobRows) statusByActionId.set(job.actionId, job.status as NonNullable<VsMemberHistoryWeek["settled"]>["syncStatus"]);
  }
  const weeks: VsMemberHistoryWeek[] = visibleWeeks.map((row) => ({
    weekEnding: row.weekEnding,
    status: vsMemberHistoryStatus(row.evaluation),
    outcome: row.evaluation.outcome,
    modelVersion: row.evaluation.modelVersion ?? 1,
    policyVersion: row.evaluation.policyVersion,
    score: row.evaluation.score === null ? null : String(row.evaluation.score),
    threshold: row.evaluation.threshold,
    counts: row.evaluation.counts ?? null,
    settled: row.evaluation.settled ? { kind: row.evaluation.settled.kind, targetRank: row.evaluation.settled.targetRank, syncStatus: statusByActionId.get(row.evaluation.settled.actionId) ?? null } : null,
    correctionReview: row.evaluation.correctionReview === true,
  }));
  return { weeks, nextBefore: history.length === 13 ? weeks[11].weekEnding : null };
}

export async function loadVsMemberHistory(sessionId: string, allianceId: string, memberId: string, rawQuery: Record<string, string | undefined>) {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const now = new Date();
  const query = parseVsMemberWeekQuery({ weekStart: rawQuery.weekStart }, now);
  const weekEnding = addCalendarDays(query.weekStart, 6);
  const lastClosed = lastClosedVsWeek(now);
  const beforeWeek = rawQuery.beforeWeek;
  if (beforeWeek === undefined || !validateVsPeriod(beforeWeek, "weekly") || beforeWeek > lastClosed) throw new VsComplianceError("invalid_week");
  const db = getDb();
  await assertVsMemberScope(db, allianceId, memberId, weekEnding);
  const history = await db.select({ id: schema.vsComplianceEvaluations.id, weekEnding: schema.vsComplianceEvaluations.weekEnding, evaluation: schema.vsComplianceEvaluations.evaluation, memberSnapshot: schema.vsComplianceEvaluations.memberSnapshot, remoteVerifiedAt: schema.vsComplianceEvaluations.remoteVerifiedAt }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), lte(schema.vsComplianceEvaluations.weekEnding, lastClosed), lt(schema.vsComplianceEvaluations.weekEnding, beforeWeek))).orderBy(desc(schema.vsComplianceEvaluations.weekEnding), desc(schema.vsComplianceEvaluations.id)).limit(13);
  return { allianceId, memberId, weekStart: query.weekStart, weekEnding, history: await mapVsMemberHistoryPage(db, allianceId, memberId, history) };
}

const detailStatusFallback = (
  evaluation: VsComplianceEvaluation,
  days: VsMemberDay[],
): VsMemberRow["status"] => {
  if (evaluation.outcome === "not_eligible") return "not_eligible";
  if (evaluation.outcome === "excused") return "excused";
  if (evaluation.outcome === "waived") return "waived";
  if (evaluation.outcome === "pending_data") return "needs_evidence";
  if (evaluation.outcome === "missed") {
    const required = days.filter((day) => day.state === "met" || day.state === "missed" || day.state === "recorded");
    if (evaluation.modelVersion === 2 && required.length > 0 && required.every((day) => day.score === "0")) return "zero";
    if (evaluation.modelVersion !== 2 && evaluation.score === 0) return "zero";
    return "below";
  }
  return "meeting";
};

const detailExcusalFallback = (days: VsMemberDay[]): VsMemberRow["excusal"] => {
  const closed = days.filter((day) => day.state !== "open" && day.state !== "in_progress");
  if (closed.some((day) => day.state === "pending_excusal")) return "pending";
  const excused = closed.filter((day) => day.state === "excused").length;
  if (!excused) return "none";
  return excused === closed.length ? "full" : "partial";
};

function persistedWeek(persisted: { evaluation: VsComplianceEvaluation; input: VsComplianceWeek }): VsMemberDetailWeek {
  const evaluation = persisted.evaluation;
  const days: VsMemberDay[] = (evaluation.days ?? []).map((day) => ({
    date: day.date,
    score: day.score === null ? null : String(day.score),
    state:
      day.assessment === "met" ? "met"
      : day.assessment === "missed" ? "missed"
      : day.assessment === "excused" ? "excused"
      : day.assessment === "open" ? "open"
      : "unverified",
    source: null,
  }));
  const counts = evaluation.counts ?? { required: days.filter((day) => day.state === "met" || day.state === "missed" || day.state === "unverified").length, met: days.filter((day) => day.state === "met").length, missed: days.filter((day) => day.state === "missed").length, excused: days.filter((day) => day.state === "excused").length, unknown: days.filter((day) => day.state === "unverified").length };
  const knownDays = days.filter((day) => day.score !== null).length;
  const subtotal = days.reduce((sum, day) => sum + (day.score === null ? BigInt(0) : BigInt(day.score)), BigInt(0));
  const recommendation = evaluation.recommendation;
  return {
    modelVersion: evaluation.modelVersion === 2 ? 2 : 1,
    status: detailStatusFallback(evaluation, days),
    excusal: detailExcusalFallback(days),
    signal:
      recommendation.kind === "demote" ? { kind: "review_ready", targetRank: recommendation.targetRank }
      : recommendation.kind === "remove" ? { kind: "removal_review", targetRank: null }
      : recommendation.kind === "leadership_review" ? { kind: "leadership_review", targetRank: null }
      : evaluation.signal?.kind === "concern" ? { kind: "at_risk", targetRank: null }
      : evaluation.signal?.kind === "promotion" ? { kind: "promotion", targetRank: evaluation.signal.targetRank }
      : { kind: "none", targetRank: null },
    days,
    dailySubtotal: knownDays ? subtotal.toString() : null,
    knownDays,
    reportedTotal: persisted.input.evidence.source === "weekly" && persisted.input.evidence.score !== null ? String(persisted.input.evidence.score) : null,
    counts,
    outcome: evaluation.outcome,
    score: evaluation.score === null ? null : String(evaluation.score),
    threshold: evaluation.threshold,
    streak: evaluation.streak,
    policyVersion: evaluation.policyVersion,
    provisional: evaluation.provisional === true,
    sequence: evaluation.sequence
      ? {
          demotion: {
            unit: evaluation.sequence.demotion.unit,
            length: evaluation.sequence.demotion.length,
            progress: evaluation.sequence.demotion.progress,
            episode: evaluation.sequence.demotion.episode?.units ?? null,
            recoveredAfter: evaluation.sequence.demotion.recoveredAfter,
          },
          promotion: evaluation.sequence.promotion,
        }
      : null,
    settled: evaluation.settled ? { kind: evaluation.settled.kind, targetRank: evaluation.settled.targetRank, syncStatus: null } : null,
    correctionReview: evaluation.correctionReview === true,
  };
}

export async function loadVsMemberDetail(sessionId: string, allianceId: string, memberId: string, rawQuery: Record<string, string | undefined>): Promise<VsMemberDetailResponse> {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const now = new Date();
  const query = parseVsMemberWeekQuery({ weekStart: rawQuery.weekStart }, now);
  const weekEnding = addCalendarDays(query.weekStart, 6);
  const lastClosed = lastClosedVsWeek(now);
  const live = weekEnding > lastClosed;
  const weekClosed = Date.parse(`${weekEnding}T02:00:00.000Z`) <= now.getTime();
  if (rawQuery.beforeWeek !== undefined && (!validateVsPeriod(rawQuery.beforeWeek, "weekly") || rawQuery.beforeWeek > lastClosed)) throw new VsComplianceError("invalid_week");
  let canManage = false;
  try { await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION); canManage = true; }
  catch (error) { if (!(error instanceof VsComplianceError) || error.code !== "forbidden") throw error; }

  const db = getDb();
  await assertVsMemberScope(db, allianceId, memberId, weekEnding);
  const external = await prepareExternalEvidence(allianceId, [weekEnding]);
  const [result, inputVersion, persisted, history] = await Promise.all([
    computeComplianceRows(db, allianceId, [weekEnding], external, { now }),
    loadComplianceStateVersion(allianceId),
    db.select({ id: schema.vsComplianceEvaluations.id, memberId: schema.vsComplianceEvaluations.memberId, memberName: schema.vsComplianceEvaluations.memberName, weekEnding: schema.vsComplianceEvaluations.weekEnding, input: schema.vsComplianceEvaluations.input, evaluation: schema.vsComplianceEvaluations.evaluation, memberSnapshot: schema.vsComplianceEvaluations.memberSnapshot, remoteEvidence: schema.vsComplianceEvaluations.remoteEvidence, remoteVerifiedAt: schema.vsComplianceEvaluations.remoteVerifiedAt }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))).limit(1),
    db.select({ id: schema.vsComplianceEvaluations.id, weekEnding: schema.vsComplianceEvaluations.weekEnding, evaluation: schema.vsComplianceEvaluations.evaluation, memberSnapshot: schema.vsComplianceEvaluations.memberSnapshot, remoteVerifiedAt: schema.vsComplianceEvaluations.remoteVerifiedAt }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.memberId, memberId), lte(schema.vsComplianceEvaluations.weekEnding, lastClosed))).orderBy(desc(schema.vsComplianceEvaluations.weekEnding), desc(schema.vsComplianceEvaluations.id)).limit(13),
  ]);
  const computed = result.rows.find((row) => row.memberId === memberId && row.weekEnding === weekEnding);
  const persistedRow = persisted[0] ?? null;
  if (!computed && !persistedRow) throw new VsComplianceError("not_found", 404);

  const roster = result.facts.members.find((member) => member.memberId === memberId);
  const policy = policyForVsWeek(result.facts.policies, weekEnding);

  let week: VsMemberDetailWeek;
  if (computed) {
    const resolved = resolveComplianceEvidence(result.facts, memberId, weekEnding, external, computed.remoteEvidence, computed.remoteVerifiedAt);
    const view = buildVsMemberRow({
      memberId,
      name: roster?.name ?? computed.memberName,
      member: computed.memberSnapshot,
      days: resolved.daily,
      evaluation: computed.evaluation,
      policy,
      weekClosed,
      reportedTotal: resolved.evidence.source === "weekly" ? resolved.evidence.score : null,
      now: now.getTime(),
    });
    const evaluation = computed.evaluation;
    week = {
      modelVersion: evaluation.modelVersion === 2 ? 2 : 1,
      status: view.status,
      excusal: view.excusal,
      signal: view.signal,
      days: view.days,
      dailySubtotal: view.dailySubtotal,
      knownDays: view.knownDays,
      reportedTotal: view.reportedTotal,
      counts: view.counts,
      outcome: evaluation.outcome,
      score: evaluation.score === null ? null : String(evaluation.score),
      threshold: evaluation.threshold,
      streak: evaluation.streak,
      policyVersion: evaluation.policyVersion,
      provisional: evaluation.provisional === true,
      sequence: evaluation.sequence
        ? {
            demotion: {
              unit: evaluation.sequence.demotion.unit,
              length: evaluation.sequence.demotion.length,
              progress: evaluation.sequence.demotion.progress,
              episode: evaluation.sequence.demotion.episode?.units ?? null,
              recoveredAfter: evaluation.sequence.demotion.recoveredAfter,
            },
            promotion: evaluation.sequence.promotion,
          }
        : null,
      settled: evaluation.settled
        ? {
            kind: evaluation.settled.kind,
            targetRank: evaluation.settled.targetRank,
            syncStatus: result.jobs.find((job) => job.actionId === evaluation.settled?.actionId)?.status ?? null,
          }
        : null,
      correctionReview: evaluation.correctionReview === true,
    };
  } else {
    week = persistedWeek(persistedRow!);
  }

  let action: VsMemberDetailResponse["action"] = null;
  if (computed && persistedRow && persistedRow.id === computed.id && persistedRow.evaluation.confirmationBasis === computed.evaluation.confirmationBasis) {
    const evaluation = computed.evaluation;
    const closed = weekEnding <= lastClosed;
    const canConfirm = canManage && closed && !evaluation.provisional && !evaluation.settled && ["demote", "remove"].includes(evaluation.recommendation.kind);
    const canWaive = canManage && closed && !evaluation.provisional && evaluation.outcome !== "waived" && (["missed", "pending_data"].includes(evaluation.outcome) || !!evaluation.settled);
    if (canConfirm || canWaive) action = { eventId: computed.id, confirmationBasis: computed.evaluation.confirmationBasis, canConfirm, canWaive };
  }

  return {
    allianceId,
    memberId,
    inputVersion,
    weekStart: query.weekStart,
    weekEnding,
    live,
    canManage,
    member: computed
      ? {
          name: roster?.name ?? computed.memberName,
          currentRank: computed.memberSnapshot.currentRank,
          rosterStatus: computed.memberSnapshot.active ? "active" : "former",
          joinedAt: computed.memberSnapshot.joinedAt,
        }
      : {
          name: persistedRow!.memberName,
          currentRank: null,
          rosterStatus: "former",
          joinedAt: persistedRow!.memberSnapshot.joinedAt,
        },
    policy: {
      modelVersion: policy?.modelVersion ?? null,
      version: policy?.version ?? null,
      enabled: policy?.enabled ?? false,
      dailyThreshold: vsMemberDisplayThreshold(policy),
      weeklyMinimum: policy && policy.modelVersion !== 2 ? policy.weeklyMinimum : null,
      allowedMissedDays: policy?.modelVersion === 2 ? policy.allowedMissedDays : null,
    },
    source: { native: external.native, verifiedAt: !external.native && external.verifiedAt && external.weeks.has(weekEnding) ? external.verifiedAt.toISOString() : null, stale: !external.native && !(external.verifiedAt && external.weeks.has(weekEnding)) },
    week,
    eventId: persistedRow?.id ?? null,
    action,
    history: await mapVsMemberHistoryPage(db, allianceId, memberId, history),
  };
}

export async function loadVsMemberScoreRevisions(sessionId: string, allianceId: string, memberId: string, rawQuery: Record<string, string | undefined>): Promise<VsMemberRevisionsResponse> {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const now = new Date();
  const query = parseVsMemberWeekQuery({ weekStart: rawQuery.weekStart }, now);
  const weekEnding = addCalendarDays(query.weekStart, 6);
  const rawPage = rawQuery.page;
  const page = rawPage === undefined ? 1 : /^\d+$/.test(rawPage) ? Number(rawPage) : 0;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new VsComplianceError("invalid_week");
  const db = getDb();
  await assertVsMemberScope(db, allianceId, memberId, weekEnding);
  const dates = Array.from({ length: 6 }, (_, i) => addCalendarDays(weekEnding, i - 6));
  const rows = await db.select({ recordedDate: schema.vsScoreHeads.recordedDate, period: schema.vsScoreHeads.period, version: schema.vsScoreRevisions.version, score: schema.vsScoreRevisions.score, origin: schema.vsScoreRevisions.origin, recordedAt: schema.vsScoreRevisions.recordedAt, actorName: schema.hqUsers.displayName }).from(schema.vsScoreRevisions).innerJoin(schema.vsScoreHeads, and(eq(schema.vsScoreRevisions.headId, schema.vsScoreHeads.id), eq(schema.vsScoreRevisions.allianceId, schema.vsScoreHeads.allianceId))).leftJoin(schema.hqUsers, eq(schema.vsScoreRevisions.recordedByHqUserId, schema.hqUsers.id)).where(and(eq(schema.vsScoreRevisions.allianceId, allianceId), eq(schema.vsScoreHeads.allianceId, allianceId), eq(schema.vsScoreHeads.memberId, memberId), or(and(eq(schema.vsScoreHeads.period, "weekly"), eq(schema.vsScoreHeads.recordedDate, weekEnding)), and(eq(schema.vsScoreHeads.period, "daily"), inArray(schema.vsScoreHeads.recordedDate, dates))))).orderBy(desc(schema.vsScoreRevisions.recordedAt), desc(schema.vsScoreRevisions.id)).limit(51).offset((page - 1) * 50);
  return {
    memberId,
    weekStart: query.weekStart,
    weekEnding,
    page,
    hasMore: rows.length > 50,
    revisions: rows.slice(0, 50).map((row) => ({
      recordedDate: row.recordedDate,
      period: row.period,
      version: row.version,
      score: row.score === null ? null : String(row.score),
      origin: row.origin,
      recordedAt: row.recordedAt.toISOString(),
      actorName: row.actorName,
    })),
  };
}
