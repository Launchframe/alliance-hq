import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { policyForVsWeek, validateVsPolicy, vsWeeklyThreshold } from "./policy.shared";
import { VsComplianceError, type VsComplianceEvaluation, type VsComplianceMember, type VsComplianceWeek, type VsPolicyVersion, type VsRecommendation } from "./types.shared";

function noRecommendation(): VsRecommendation {
  return { kind: "none", targetRank: null };
}

export function recommendVsPenalty(member: VsComplianceMember, policy: VsPolicyVersion, streak: number): VsRecommendation {
  validateVsPolicy(policy);
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

export function rebuildVsCompliance(input: {
  weeks: readonly VsComplianceWeek[];
  policies: readonly VsPolicyVersion[];
  member: VsComplianceMember;
  now: Date;
}): VsComplianceEvaluation[] {
  const { member, policies, now } = input;
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
  let streak: number | null = 0;
  let historyBasis: string[] = [];
  return weeks.map((week) => {
    if (previousWeek ? addCalendarDays(previousWeek, 7) !== week.weekEnding : firstEligibleWeek !== null && week.weekEnding > firstEligibleWeek) {
      streak = null;
      historyBasis.push(JSON.stringify({ gapAfter: previousWeek, before: week.weekEnding }));
    }
    previousWeek = week.weekEnding;
    const policy = policyForVsWeek(policies, week.weekEnding);
    const threshold = policy?.weeklyMinimum == null ? null : vsWeeklyThreshold(policy.weeklyMinimum, policy.leewayPct);
    const start = Date.parse(`${addCalendarDays(week.weekEnding, -6)}T02:00:00.000Z`);
    const end = Date.parse(`${week.weekEnding}T02:00:00.000Z`);
    const eligible = member.active && !!member.joinedAt && Date.parse(member.joinedAt) <= start &&
      (member.leftAt === null || Date.parse(member.leftAt) >= end) && end <= now.getTime() && policy?.enabled === true;
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
      policy: policy ? [policy.version, policy.effectiveWeek, policy.enabled, policy.dailyTarget, policy.weeklyMinimum, policy.leewayPct, policy.preset, policy.removalThreshold] : null,
      membership: [member.joinedAt, member.leftAt],
      evidence: [week.evidence.state, score, week.evidence.source, week.evidence.dailyCoverage, [...new Set(week.evidence.basis)].sort()],
      excused: week.excused, pendingExcusal: week.pendingExcusal, waived: week.waived, outcome,
    });
    const evaluationBasis = JSON.stringify({ ownBasis, historyBasis, streak });
    historyBasis = [...historyBasis, ownBasis];
    const recommendation = outcome === "missed" && streak !== null && policy && !week.settled ? recommendVsPenalty(member, policy, streak) : noRecommendation();
    return {
      weekEnding: week.weekEnding, outcome, threshold, score, policyVersion: policy?.version ?? null, streak, recommendation, evaluationBasis,
      confirmationBasis: JSON.stringify({ evaluationBasis, rank: member.currentRank, rankVersion: member.rankVersion, active: member.active, isOwner: member.isOwner, recommendation }),
      settled: week.settled ?? null,
      correctionReview: !!week.settled && week.settled.evaluationBasis !== evaluationBasis,
    };
  });
}
