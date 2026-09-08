import type { VsWeekEvidence } from "@/lib/vs-scores/evidence.shared";

export type VsPolicy = {
  enabled: boolean;
  dailyTarget: number;
  weeklyMinimum: number | null;
  leewayPct: number;
  preset: "rank_aware" | "consecutive";
  removalThreshold: number;
};

export type VsPolicyVersion = VsPolicy & { version: number; effectiveWeek: string };

export type VsComplianceMember = {
  active: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  currentRank: number | null;
  rankVersion: string;
  isOwner: boolean;
};

export type VsRecommendation = {
  kind: "none" | "demote" | "remove" | "leadership_review";
  targetRank: number | null;
};

export type VsSettledAction = {
  memberSnapshot?: VsComplianceMember;
  actionId: string;
  evaluationBasis: string;
  kind: "demote" | "remove";
  targetRank: number | null;
};

export type VsComplianceWeek = {
  eligibilitySnapshot?: VsComplianceMember;
  weekEnding: string;
  evidence: VsWeekEvidence;
  excused: boolean;
  pendingExcusal: boolean;
  waived: boolean;
  settled?: VsSettledAction;
};

export type VsComplianceEvaluation = {
  weekEnding: string;
  outcome: "passed" | "excused" | "waived" | "missed" | "pending_data" | "not_eligible";
  threshold: number | null;
  score: number | null;
  policyVersion: number | null;
  streak: number | null;
  recommendation: VsRecommendation;
  evaluationBasis: string;
  confirmationBasis: string;
  settled: VsSettledAction | null;
  correctionReview: boolean;
};

export class VsComplianceError extends Error {
  constructor(public readonly code: "invalid_policy" | "invalid_week" | "changed" | "forbidden" | "not_found" | "handled" | "reason_required" | "failed", public readonly status = 400) {
    super(code);
  }
}
