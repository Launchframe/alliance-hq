import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { policyForVsWeek, validateVsPolicy, vsThreshold, vsWeeklyThreshold } from "./policy.shared";
import { VsComplianceError, type VsComplianceDay, type VsComplianceEvaluation, type VsComplianceMember, type VsComplianceWeek, type VsDailyPolicyVersion, type VsPolicyVersion, type VsRecommendation } from "./types.shared";

function noRecommendation(): VsRecommendation {
  return { kind: "none", targetRank: null };
}

export function recommendVsPenalty(member: VsComplianceMember, policy: VsPolicyVersion, streak: number): VsRecommendation {
  validateVsPolicy(policy);
  if (policy.modelVersion === 2) return noRecommendation();
  if (!member.active || !policy.enabled || !Number.isSafeInteger(streak) || streak < 1) return noRecommendation();
  const rank = member.currentRank;
  if (member.isOwner || rank === null || !Number.isInteger(rank) || rank < 1 || rank >= 5) return { kind: "leadership_review", targetRank: null };
  if (policy.preset === "rank_aware") return rank === 1 ? { kind: "remove", targetRank: null } : { kind: "demote", targetRank: rank - 1 };
  if (streak >= policy.removalThreshold) return { kind: "remove", targetRank: null };
  const targetRank = streak === 1 ? 2 : 1;
  return rank > targetRank ? { kind: "demote", targetRank } : noRecommendation();
}

function firstMembershipWeek(joinedAt: string | null): string | null {
  if (!joinedAt || !Number.isFinite(Date.parse(joinedAt))) return null;
  const monday = getWeekStartMonday(getServerCalendarDate(new Date(joinedAt)));
  return addCalendarDays(monday, Date.parse(joinedAt) <= Date.parse(`${monday}T02:00:00.000Z`) ? 6 : 13);
}

type VsDayAssessment = { date: string; assessment: "met" | "missed" | "excused" | "unknown" | "open"; score: number | null };

type VsSequenceState = {
  demotion: { progress: number | null; units: string[] };
  promotion: { progress: number | null; units: string[] };
  episode: { units: string[] } | null;
  recoveredAfter: string[];
};

function freshVsSequenceState(): VsSequenceState {
  return { demotion: { progress: 0, units: [] }, promotion: { progress: 0, units: [] }, episode: null, recoveredAfter: [] };
}

export function vsDayPhase(date: string, now: number): "open" | "in_progress" | "closed" {
  if (now < Date.parse(`${date}T02:00:00.000Z`)) return "open";
  return now < Date.parse(`${addCalendarDays(date, 1)}T02:00:00.000Z`) ? "in_progress" : "closed";
}

function assessVsDay(day: VsComplianceDay, threshold: number, now: number): VsDayAssessment["assessment"] {
  if (vsDayPhase(day.date, now) !== "closed") return "open";
  if (day.excused) return "excused";
  if (day.pendingExcusal) return "unknown";
  if (day.state !== "ready" || day.score === null) return "unknown";
  return day.score >= threshold ? "met" : "missed";
}

export function rebuildVsCompliance(input: {
  weeks: readonly VsComplianceWeek[];
  policies: readonly VsPolicyVersion[];
  member: VsComplianceMember;
  now: Date;
  digest?: (basis: string) => string;
  consumedThrough?: string | null;
}): VsComplianceEvaluation[] {
  const { member, policies, now } = input;
  const consumedThrough = input.consumedThrough ?? null;
  if (!Number.isFinite(now.getTime())) throw new VsComplianceError("invalid_week");
  const weeks = [...input.weeks].sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
  const seen = new Set<string>();
  for (const week of weeks) {
    if (!validateVsPeriod(week.weekEnding, "weekly") || seen.has(week.weekEnding)) throw new VsComplianceError("invalid_week");
    seen.add(week.weekEnding);
  }
  for (const policy of policies) {
    validateVsPolicy(policy);
    if (!validateVsPeriod(policy.effectiveWeek, "weekly") || !Number.isSafeInteger(policy.version) || policy.version < 1) throw new VsComplianceError("invalid_policy");
  }
  const firstPolicyWeek = policies.filter((policy) => policy.enabled).map((policy) => policy.effectiveWeek).sort()[0];
  const firstMemberWeek = firstMembershipWeek(member.joinedAt);
  const firstEligibleWeek = firstMemberWeek && firstPolicyWeek ? (firstMemberWeek > firstPolicyWeek ? firstMemberWeek : firstPolicyWeek) : null;
  let previousWeek: string | null = null;
  let previousModel = 1;
  let previousPolicyVersion: number | null = null;
  let streak: number | null = 0;
  let historyBasis: string[] = [];
  let sequence = freshVsSequenceState();
  return weeks.map((week) => {
    if (previousWeek ? addCalendarDays(previousWeek, 7) !== week.weekEnding : firstEligibleWeek !== null && week.weekEnding > firstEligibleWeek) {
      streak = null;
      sequence.demotion = { progress: null, units: [] };
      sequence.promotion = { progress: null, units: [] };
      historyBasis.push(JSON.stringify({ gapAfter: previousWeek, before: week.weekEnding }));
    }
    const policy = policyForVsWeek(policies, week.weekEnding);
    const model = policy?.modelVersion ?? 1;
    if (previousWeek !== null && (model !== previousModel || model === 2 && policy?.version !== previousPolicyVersion)) {
      streak = 0;
      sequence = freshVsSequenceState();
      historyBasis.push(JSON.stringify({ policyBoundary: `${previousModel}:${previousPolicyVersion}`, next: `${model}:${policy?.version ?? null}` }));
    }
    previousWeek = week.weekEnding;
    previousModel = model;
    previousPolicyVersion = policy?.version ?? null;
    const start = Date.parse(`${addCalendarDays(week.weekEnding, -6)}T02:00:00.000Z`);
    const end = Date.parse(`${week.weekEnding}T02:00:00.000Z`);
    const eligibility = week.settled?.memberSnapshot ?? week.eligibilitySnapshot ?? member;
    const memberEligible = eligibility.active && !!eligibility.joinedAt && Date.parse(eligibility.joinedAt) <= start &&
      (eligibility.leftAt === null || Date.parse(eligibility.leftAt) >= end) && policy?.enabled === true;
    if (model === 2 && policy) {
      const result = evaluateVsDailyWeek(week, policy as VsDailyPolicyVersion, eligibility, member, memberEligible, end, now, consumedThrough, sequence, historyBasis, input.digest);
      historyBasis = input.digest ? [input.digest(JSON.stringify([historyBasis, result.ownBasis]))] : [...historyBasis, result.ownBasis];
      const { ownBasis: _ownBasis, ...evaluation } = result;
      return evaluation;
    }
    const legacyPolicy = policy?.modelVersion === 2 ? null : policy;
    const threshold = legacyPolicy?.weeklyMinimum == null ? null : vsWeeklyThreshold(legacyPolicy.weeklyMinimum, legacyPolicy.leewayPct);
    const eligible = memberEligible && end <= now.getTime();
    const complete = week.evidence.basis.length > 0 && (week.evidence.source === "weekly" || week.evidence.source === "daily" && week.evidence.dailyCoverage === 6);
    const score = complete && week.evidence.state === "ready" && week.evidence.score !== null && Number.isSafeInteger(week.evidence.score) && week.evidence.score >= 0 ? week.evidence.score : null;
    const outcome: VsComplianceEvaluation["outcome"] = !eligible ? "not_eligible" : week.waived ? "waived" : week.excused ? "excused" :
      score !== null && threshold !== null && score >= threshold ? "passed" :
        score === null || week.pendingExcusal ? "pending_data" : "missed";
    if (["passed", "excused", "waived", "not_eligible"].includes(outcome)) {
      streak = 0;
      historyBasis = [];
    } else if (outcome === "pending_data") {
      streak = null;
    } else if (streak !== null) {
      streak += 1;
    }
    const ownBasis = JSON.stringify({
      weekEnding: week.weekEnding,
      policy: legacyPolicy ? [legacyPolicy.version, legacyPolicy.effectiveWeek, legacyPolicy.enabled, legacyPolicy.dailyTarget, legacyPolicy.weeklyMinimum, legacyPolicy.leewayPct, legacyPolicy.preset, legacyPolicy.removalThreshold] : null,
      membership: [eligibility.joinedAt, eligibility.leftAt],
      evidence: [week.evidence.state, score, week.evidence.source, week.evidence.dailyCoverage, [...new Set(week.evidence.basis)].sort()],
      excused: week.excused, pendingExcusal: week.pendingExcusal, waived: week.waived, outcome,
    });
    const rawBasis = JSON.stringify({ ownBasis, historyBasis, streak });
    const evaluationBasis = input.digest ? input.digest(rawBasis) : rawBasis;
    historyBasis = input.digest ? [input.digest(JSON.stringify([historyBasis, ownBasis]))] : [...historyBasis, ownBasis];
    const recommendation = outcome === "missed" && streak !== null && legacyPolicy && !week.settled ? recommendVsPenalty(member, legacyPolicy, streak) : noRecommendation();
    return {
      weekEnding: week.weekEnding, outcome, threshold, score, policyVersion: policy?.version ?? null, streak, recommendation, evaluationBasis,
      confirmationBasis: JSON.stringify({ evaluationBasis, rank: member.currentRank, rankVersion: member.rankVersion, active: member.active, isOwner: member.isOwner, recommendation }),
      settled: week.settled ?? null,
      correctionReview: !!week.settled && week.settled.evaluationBasis !== evaluationBasis,
    };
  });
}

function evaluateVsDailyWeek(
  week: VsComplianceWeek,
  policy: VsDailyPolicyVersion,
  eligibility: VsComplianceMember,
  member: VsComplianceMember,
  memberEligible: boolean,
  end: number,
  now: Date,
  consumedThrough: string | null,
  sequence: VsSequenceState,
  historyBasis: string[],
  digest?: (basis: string) => string,
): VsComplianceEvaluation & { ownBasis: string } {
  const threshold = vsThreshold(policy.dailyTarget, policy.leewayPct);
  const days = week.days ?? [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const assessments: VsDayAssessment[] = Array.from({ length: 6 }, (_, index) => {
    const date = addCalendarDays(week.weekEnding, index - 6);
    const day = byDate.get(date);
    const assessment = day ? assessVsDay(day, threshold, now.getTime()) : now.getTime() < Date.parse(`${addCalendarDays(date, 1)}T02:00:00.000Z`) ? "open" : "unknown";
    return { date, assessment, score: day?.score ?? null };
  });
  const weekClosed = end <= now.getTime();
  const provisional = memberEligible && !weekClosed;
  const required = assessments.filter((day) => day.assessment === "met" || day.assessment === "missed" || day.assessment === "unknown");
  const counts = {
    required: required.length,
    met: assessments.filter((day) => day.assessment === "met").length,
    missed: assessments.filter((day) => day.assessment === "missed").length,
    excused: assessments.filter((day) => day.assessment === "excused").length,
    unknown: assessments.filter((day) => day.assessment === "unknown").length,
  };
  const outcome: VsComplianceEvaluation["outcome"] = !memberEligible ? "not_eligible" : !weekClosed ? "pending_data" :
    week.waived ? "waived" : required.length === 0 ? "excused" :
      counts.unknown > 0 ? "pending_data" : counts.missed > policy.allowedMissedDays ? "missed" : "passed";
  const consumed = !!week.settled || (consumedThrough !== null && week.weekEnding <= consumedThrough);
  const qualifyDemotion = () => {
    if (sequence.demotion.progress !== null && sequence.demotion.progress >= policy.demotion.length) {
      if (sequence.episode) sequence.episode.units.push(...sequence.demotion.units);
      else sequence.episode = { units: [...sequence.demotion.units] };
      sequence.demotion.progress = 0;
      sequence.demotion.units = [];
    }
  };
  const walkDay = (run: { progress: number | null; units: string[] }, isDemotion: boolean, day: VsDayAssessment) => {
    if (day.assessment === "open" || day.assessment === "excused") return;
    if (day.assessment === "unknown") { run.progress = null; run.units = []; return; }
    if (isDemotion === (day.assessment === "missed")) {
      run.progress = (run.progress ?? 0) + 1;
      run.units.push(day.date);
      if (isDemotion) qualifyDemotion();
      return;
    }
    run.progress = 0;
    run.units = [];
    if (isDemotion && sequence.episode) sequence.recoveredAfter.push(day.date);
  };
  if (consumed || outcome === "not_eligible") {
    sequence.demotion = { progress: 0, units: [] };
    sequence.promotion = { progress: 0, units: [] };
    sequence.episode = null;
    sequence.recoveredAfter = [];
  } else if (outcome === "waived") {
    sequence.demotion = { progress: 0, units: [] };
    sequence.episode = null;
    sequence.recoveredAfter = [];
  } else {
    for (const day of assessments) {
      if (policy.demotion.unit === "days") walkDay(sequence.demotion, true, day);
      if (policy.promotion.unit === "days") walkDay(sequence.promotion, false, day);
    }
    if (!provisional) {
      if (outcome === "pending_data") {
        if (policy.demotion.unit === "weeks") sequence.demotion = { progress: null, units: [] };
        if (policy.promotion.unit === "weeks") sequence.promotion = { progress: null, units: [] };
      } else if (outcome === "missed" || outcome === "passed") {
        if (policy.demotion.unit === "weeks") {
          if (outcome === "missed") { sequence.demotion.progress = (sequence.demotion.progress ?? 0) + 1; sequence.demotion.units.push(week.weekEnding); }
          else {
            sequence.demotion.progress = 0;
            sequence.demotion.units = [];
            if (sequence.episode) sequence.recoveredAfter.push(week.weekEnding);
          }
        }
        if (policy.promotion.unit === "weeks") {
          if (outcome === "passed") { sequence.promotion.progress = (sequence.promotion.progress ?? 0) + 1; sequence.promotion.units.push(week.weekEnding); }
          else { sequence.promotion.progress = 0; sequence.promotion.units = []; }
        }
      }
      qualifyDemotion();
    }
  }
  const complete = week.evidence.basis.length > 0 && (week.evidence.source === "weekly" || week.evidence.source === "daily" && week.evidence.dailyCoverage === 6);
  const score = complete && week.evidence.state === "ready" && week.evidence.score !== null && Number.isSafeInteger(week.evidence.score) && week.evidence.score >= 0 ? week.evidence.score : null;
  const ownBasis = JSON.stringify({
    weekEnding: week.weekEnding, modelVersion: 2,
    policy: [policy.version, policy.effectiveWeek, policy.enabled, policy.dailyTarget, policy.leewayPct, policy.allowedMissedDays, policy.demotion.unit, policy.demotion.length, policy.promotion.unit, policy.promotion.length],
    membership: [eligibility.joinedAt, eligibility.leftAt],
    evidence: [week.evidence.state, score, week.evidence.source, week.evidence.dailyCoverage, [...new Set(week.evidence.basis)].sort()],
    days: assessments.map((day) => [day.date, day.assessment, day.score, byDate.get(day.date)?.state ?? null, byDate.get(day.date)?.source ?? null]),
    excused: week.excused, pendingExcusal: week.pendingExcusal, waived: week.waived, outcome,
    sequence: {
      demotion: [sequence.demotion.progress, sequence.demotion.units], promotion: [sequence.promotion.progress],
      episode: sequence.episode?.units ?? null, recoveredAfter: sequence.recoveredAfter,
    },
    consumedThrough,
  });
  const rawBasis = JSON.stringify({ ownBasis, historyBasis, streak: sequence.demotion.progress });
  const evaluationBasis = digest ? digest(rawBasis) : rawBasis;
  const correctionReview = !!week.settled && week.settled.evaluationBasis !== evaluationBasis;
  const decided = recommendationKind(week, sequence, member, provisional, weekClosed, outcome);
  const recommendation = decided ?? noRecommendation();
  const actionable = recommendation.kind !== "none";
  const concern = !actionable && ((sequence.demotion.progress !== null && sequence.demotion.progress >= 1) || counts.missed > policy.allowedMissedDays || provisional && sequence.episode !== null);
  const signal: NonNullable<VsComplianceEvaluation["signal"]> = actionable ? { kind: "none", targetRank: null, reached: false }
    : !concern && !correctionReview && sequence.episode === null &&
      (member.currentRank === 1 || member.currentRank === 2) && !member.isOwner &&
      sequence.promotion.progress !== null && sequence.promotion.progress >= policy.promotion.length
      ? { kind: "promotion", targetRank: member.currentRank + 1, reached: true }
      : concern ? { kind: "concern", targetRank: null, reached: sequence.episode !== null } : { kind: "none", targetRank: null, reached: false };
  return {
    weekEnding: week.weekEnding, outcome, threshold, score, policyVersion: policy.version, streak: sequence.demotion.progress,
    recommendation, evaluationBasis,
    confirmationBasis: JSON.stringify({ evaluationBasis, rank: member.currentRank, rankVersion: member.rankVersion, active: member.active, isOwner: member.isOwner, recommendation }),
    settled: week.settled ?? null,
    correctionReview,
    modelVersion: 2,
    ...(provisional ? { provisional: true } : {}),
    days: assessments,
    counts,
    sequence: {
      demotion: { unit: policy.demotion.unit, length: policy.demotion.length, progress: sequence.demotion.progress, episode: sequence.episode ? { units: [...sequence.episode.units] } : null, recoveredAfter: [...sequence.recoveredAfter] },
      promotion: { unit: policy.promotion.unit, length: policy.promotion.length, progress: sequence.promotion.progress },
    },
    signal,
    ownBasis,
  };
}

function recommendationKind(week: VsComplianceWeek, sequence: VsSequenceState, member: VsComplianceMember, provisional: boolean, weekClosed: boolean, outcome: VsComplianceEvaluation["outcome"]): VsRecommendation | null {
  if (provisional || !weekClosed || !sequence.episode || week.settled || outcome === "not_eligible" || outcome === "waived" || !member.active) return null;
  const rank = member.currentRank;
  if (member.isOwner || rank === null || !Number.isInteger(rank) || rank < 1 || rank >= 5) return { kind: "leadership_review", targetRank: null };
  return rank === 1 ? { kind: "remove", targetRank: null } : { kind: "demote", targetRank: rank - 1 };
}
