import "server-only";

import { and, asc, desc, eq, inArray, isNull, lt, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { prepareExternalEvidence, resolveComplianceEvidence } from "@/lib/vs-compliance/evidence.server";
import { policyForVsWeek } from "@/lib/vs-compliance/policy.shared";
import { computeComplianceRows } from "@/lib/vs-compliance/repository.server";
import { VsComplianceError, type VsComplianceEvaluation } from "@/lib/vs-compliance/types.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { currentVsWeekStart, buildVsMemberRow, vsMemberDisplayThreshold } from "./member-performance.shared";
import type { VsMemberDay } from "./member-performance.shared";
import { addCalendarDays } from "@/lib/trains/game-time";
import { mapPersistedMyVsDays } from "./my-performance.shared";
import type {
  MyVsCommander,
  MyVsHistory,
  MyVsHistoryWeek,
  MyVsPerformanceHistoryPage,
  MyVsPerformanceResponse,
  MyVsWeek,
} from "./my-performance.shared";

const MY_MEMBER_ID_MAX = 256;

function isMyMemberIdParam(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MY_MEMBER_ID_MAX;
}

async function listOwnedActiveMemberIds(hqUserId: string, allianceId: string): Promise<string[]> {
  const db = getDb();
  const legacy = await db
    .select({ memberId: schema.allianceMembers.ashedMemberId })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.hqMemberLinks.allianceId),
        eq(schema.allianceMembers.ashedMemberId, schema.hqMemberLinks.ashedMemberId),
      ),
    )
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
        eq(schema.allianceMembers.status, "active"),
      ),
    );
  const canonical = await db
    .select({ memberId: schema.allianceMembers.ashedMemberId })
    .from(schema.hqUserCommanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId),
    )
    .innerJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.commanderAllianceMemberships.allianceId),
        eq(schema.allianceMembers.ashedMemberId, schema.commanderAllianceMemberships.ashedMemberId),
      ),
    )
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, hqUserId),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.status, "active"),
        isNull(schema.commanderAllianceMemberships.leftAt),
        eq(schema.allianceMembers.status, "active"),
      ),
    );
  const owned = new Set<string>();
  for (const row of legacy) owned.add(row.memberId);
  for (const row of canonical) owned.add(row.memberId);
  return [...owned];
}

export async function listMyVsCommanders(hqUserId: string, allianceId: string): Promise<MyVsCommander[]> {
  const owned = await listOwnedActiveMemberIds(hqUserId, allianceId);
  if (owned.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      memberId: schema.allianceMembers.ashedMemberId,
      name: schema.allianceMembers.currentName,
      currentRank: schema.allianceMembers.allianceRank,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        inArray(schema.allianceMembers.ashedMemberId, owned),
        eq(schema.allianceMembers.status, "active"),
      ),
    )
    .orderBy(asc(schema.allianceMembers.currentName));
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.memberId) && seen.add(row.memberId));
}

export async function myVsOfficerHref(sessionId: string, allianceId: string, memberId: string | null): Promise<string | null> {
  if (!memberId) return null;
  if (await requireAlliancePermission(sessionId, allianceId, "scores:read")) return null;
  try {
    await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
    return `/vs-performance/members/${encodeURIComponent(memberId)}`;
  } catch (error) {
    if (error instanceof VsComplianceError && error.code === "forbidden") return null;
    throw error;
  }
}

function myHistoryStatus(evaluation: VsComplianceEvaluation): MyVsHistoryWeek["status"] {
  if (evaluation.outcome === "passed") return "meeting";
  if (evaluation.outcome === "excused") return "excused";
  if (evaluation.outcome === "waived") return "waived";
  if (evaluation.outcome === "pending_data") return "needs_evidence";
  if (evaluation.outcome === "not_eligible") return "not_eligible";
  if (evaluation.modelVersion === 2) {
    const assessed = (evaluation.days ?? []).filter((day) => day.assessment === "met" || day.assessment === "missed");
    const verifiedZero = assessed.length > 0 && evaluation.counts?.unknown === 0 && assessed.every((day) => day.assessment === "missed" && day.score === 0);
    return verifiedZero ? "zero" : "below";
  }
  return evaluation.score === 0 ? "zero" : "below";
}

function mapMySequence(evaluation: VsComplianceEvaluation): MyVsWeek["sequence"] {
  const sequence = evaluation.sequence;
  if (!sequence) return null;
  return {
    demotion: {
      unit: sequence.demotion.unit,
      length: sequence.demotion.length,
      progress: sequence.demotion.episode ? sequence.demotion.episode.units.length : sequence.demotion.progress,
    },
    promotion: {
      unit: sequence.promotion.unit,
      length: sequence.promotion.length,
      progress: sequence.promotion.progress,
    },
  };
}

async function correctedWeekEndings(
  db: ReturnType<typeof getDb>,
  allianceId: string,
  memberId: string,
  weeks: readonly string[],
): Promise<Set<string>> {
  if (weeks.length === 0) return new Set();
  const rows = await db
    .select({ weekEnding: schema.vsScoreManualEdits.weekEnding })
    .from(schema.vsScoreManualEdits)
    .where(
      and(
        eq(schema.vsScoreManualEdits.allianceId, allianceId),
        eq(schema.vsScoreManualEdits.memberId, memberId),
        inArray(schema.vsScoreManualEdits.weekEnding, [...weeks]),
      ),
    );
  return new Set(rows.map((row) => row.weekEnding));
}

async function mapMyHistoryPage(
  db: ReturnType<typeof getDb>,
  allianceId: string,
  memberId: string,
  history: Array<{ weekEnding: string; evaluation: VsComplianceEvaluation }>,
): Promise<MyVsHistory> {
  const visibleWeeks = history.slice(0, 12);
  const corrected = await correctedWeekEndings(db, allianceId, memberId, visibleWeeks.map((week) => week.weekEnding));
  const weeks: MyVsHistoryWeek[] = visibleWeeks.map((row) => ({
    weekEnding: row.weekEnding,
    status: myHistoryStatus(row.evaluation),
    outcome: row.evaluation.outcome,
    counts: row.evaluation.counts ?? null,
    score: row.evaluation.score === null ? null : String(row.evaluation.score),
    excused: row.evaluation.outcome === "excused",
    corrected: corrected.has(row.weekEnding),
    settled: row.evaluation.settled
      ? { kind: row.evaluation.settled.kind, targetRank: row.evaluation.settled.targetRank }
      : null,
  }));
  return { weeks, nextBefore: history.length === 13 ? weeks[11].weekEnding : null };
}

async function loadMyHistoryRows(
  db: ReturnType<typeof getDb>,
  allianceId: string,
  memberId: string,
  lastClosed: string,
  beforeWeek?: string,
) {
  return db
    .select({
      weekEnding: schema.vsComplianceEvaluations.weekEnding,
      evaluation: schema.vsComplianceEvaluations.evaluation,
    })
    .from(schema.vsComplianceEvaluations)
    .where(
      and(
        eq(schema.vsComplianceEvaluations.allianceId, allianceId),
        eq(schema.vsComplianceEvaluations.memberId, memberId),
        lte(schema.vsComplianceEvaluations.weekEnding, lastClosed),
        ...(beforeWeek ? [lt(schema.vsComplianceEvaluations.weekEnding, beforeWeek)] : []),
      ),
    )
    .orderBy(desc(schema.vsComplianceEvaluations.weekEnding), desc(schema.vsComplianceEvaluations.id))
    .limit(13);
}

function emptyMyVsResponse(commanders: MyVsCommander[], officerHref: string | null): MyVsPerformanceResponse {
  return {
    commanders,
    member: null,
    weekStart: null,
    weekEnding: null,
    live: false,
    policy: null,
    source: null,
    week: null,
    history: { weeks: [], nextBefore: null },
    officerHref,
  };
}

export async function loadMyVsPerformance(
  sessionId: string,
  hqUserId: string,
  allianceId: string,
  rawQuery: Record<string, string | undefined>,
): Promise<MyVsPerformanceResponse> {
  const requestedMemberId = rawQuery.memberId;
  if (requestedMemberId !== undefined && !isMyMemberIdParam(requestedMemberId)) {
    throw new VsComplianceError("not_found", 404);
  }
  const commanders = await listMyVsCommanders(hqUserId, allianceId);
  const member = requestedMemberId !== undefined
    ? commanders.find((commander) => commander.memberId === requestedMemberId) ?? null
    : commanders[0] ?? null;
  if (!member) {
    if (requestedMemberId !== undefined) throw new VsComplianceError("not_found", 404);
    return emptyMyVsResponse(commanders, null);
  }

  const officerHref = await myVsOfficerHref(sessionId, allianceId, member.memberId);

  const now = new Date();
  const weekStart = currentVsWeekStart(now);
  const weekEnding = addCalendarDays(weekStart, 6);
  const lastClosed = lastClosedVsWeek(now);
  const live = weekEnding > lastClosed;
  const weekClosed = Date.parse(`${weekEnding}T02:00:00.000Z`) <= now.getTime();

  const db = getDb();
  const external = await prepareExternalEvidence(allianceId, [weekEnding]);
  const [result, persisted, history] = await Promise.all([
    computeComplianceRows(db, allianceId, [weekEnding], external, { now }),
    db
      .select({
        weekEnding: schema.vsComplianceEvaluations.weekEnding,
        evaluation: schema.vsComplianceEvaluations.evaluation,
        memberSnapshot: schema.vsComplianceEvaluations.memberSnapshot,
      })
      .from(schema.vsComplianceEvaluations)
      .where(
        and(
          eq(schema.vsComplianceEvaluations.allianceId, allianceId),
          eq(schema.vsComplianceEvaluations.memberId, member.memberId),
          eq(schema.vsComplianceEvaluations.weekEnding, weekEnding),
        ),
      )
      .limit(1),
    loadMyHistoryRows(db, allianceId, member.memberId, lastClosed),
  ]);

  const computed = result.rows.find((row) => row.memberId === member.memberId && row.weekEnding === weekEnding);
  const persistedRow = persisted[0] ?? null;
  const roster = result.facts.members.find((entry) => entry.memberId === member.memberId);
  const policy = policyForVsWeek(result.facts.policies, weekEnding);
  const corrected = await correctedWeekEndings(db, allianceId, member.memberId, [weekEnding]);

  let week: MyVsWeek | null = null;
  if (computed) {
    const resolved = resolveComplianceEvidence(result.facts, member.memberId, weekEnding, external, computed.remoteEvidence, computed.remoteVerifiedAt);
    const view = buildVsMemberRow({
      memberId: member.memberId,
      name: roster?.name ?? computed.memberName,
      member: computed.memberSnapshot,
      days: resolved.daily,
      evaluation: computed.evaluation,
      policy,
      weekClosed,
      reportedTotal: resolved.evidence.source === "weekly" ? resolved.evidence.score : null,
      now: now.getTime(),
    });
    week = {
      status: view.status,
      excusal: view.excusal,
      signal: view.signal,
      days: view.days,
      dailySubtotal: view.dailySubtotal,
      knownDays: view.knownDays,
      reportedTotal: view.reportedTotal,
      counts: view.counts,
      corrected: corrected.has(weekEnding),
      sequence: mapMySequence(computed.evaluation),
    };
  } else if (persistedRow) {
    const evaluation = persistedRow.evaluation;
    const days: VsMemberDay[] = mapPersistedMyVsDays(evaluation.days ?? []);
    const counts = evaluation.counts ?? {
      required: days.filter((day) => day.state === "met" || day.state === "missed" || day.state === "unverified").length,
      met: days.filter((day) => day.state === "met").length,
      missed: days.filter((day) => day.state === "missed").length,
      excused: days.filter((day) => day.state === "excused").length,
      unknown: days.filter((day) => day.state === "unverified").length,
    };
    week = {
      status: myHistoryStatus(evaluation),
      excusal:
        counts.excused === 0 ? "none"
        : counts.excused >= days.filter((day) => day.state !== "open" && day.state !== "in_progress").length ? "full"
        : "partial",
      signal:
        evaluation.recommendation.kind === "demote" ? { kind: "review_ready", targetRank: evaluation.recommendation.targetRank }
        : evaluation.recommendation.kind === "remove" ? { kind: "removal_review", targetRank: null }
        : evaluation.recommendation.kind === "leadership_review" ? { kind: "leadership_review", targetRank: null }
        : evaluation.signal?.kind === "concern" ? { kind: "at_risk", targetRank: null }
        : evaluation.signal?.kind === "promotion" ? { kind: "promotion", targetRank: evaluation.signal.targetRank }
        : { kind: "none", targetRank: null },
      days,
      dailySubtotal: days.some((day) => day.score !== null)
        ? days.reduce((sum, day) => sum + (day.score === null ? BigInt(0) : BigInt(day.score)), BigInt(0)).toString()
        : null,
      knownDays: days.filter((day) => day.score !== null).length,
      reportedTotal: null,
      counts,
      corrected: corrected.has(weekEnding),
      sequence: mapMySequence(evaluation),
    };
  }

  const snapshotRank =
    computed?.memberSnapshot?.currentRank ?? persistedRow?.memberSnapshot?.currentRank ?? member.currentRank;

  return {
    commanders,
    member: { ...member, currentRank: snapshotRank },
    weekStart,
    weekEnding,
    live,
    policy: {
      enabled: policy?.enabled ?? false,
      modelVersion: policy?.modelVersion ?? null,
      dailyThreshold: vsMemberDisplayThreshold(policy),
      allowedMissedDays: policy?.modelVersion === 2 ? policy.allowedMissedDays : null,
    },
    source: {
      native: external.native,
      verifiedAt: !external.native && external.verifiedAt && external.weeks.has(weekEnding) ? external.verifiedAt.toISOString() : null,
      stale: !external.native && !(external.verifiedAt && external.weeks.has(weekEnding)),
    },
    week,
    history: await mapMyHistoryPage(db, allianceId, member.memberId, history),
    officerHref,
  };
}

export async function loadMyVsPerformanceHistory(
  hqUserId: string,
  allianceId: string,
  rawQuery: Record<string, string | undefined>,
): Promise<MyVsPerformanceHistoryPage> {
  const requestedMemberId = rawQuery.memberId;
  if (!isMyMemberIdParam(requestedMemberId)) {
    throw new VsComplianceError("not_found", 404);
  }
  const now = new Date();
  const lastClosed = lastClosedVsWeek(now);
  const beforeWeek = rawQuery.beforeWeek;
  if (beforeWeek === undefined || !validateVsPeriod(beforeWeek, "weekly") || beforeWeek > lastClosed) {
    throw new VsComplianceError("invalid_week");
  }
  const commanders = await listMyVsCommanders(hqUserId, allianceId);
  if (!commanders.some((commander) => commander.memberId === requestedMemberId)) {
    throw new VsComplianceError("not_found", 404);
  }
  const db = getDb();
  const history = await loadMyHistoryRows(db, allianceId, requestedMemberId, lastClosed, beforeWeek);
  return {
    memberId: requestedMemberId,
    history: await mapMyHistoryPage(db, allianceId, requestedMemberId, history),
  };
}
