import { firstFullVsWeek } from "./policy.shared";
import type { VsPolicyVersion, VsSequenceRule } from "./types.shared";

export type VsPolicyEditorDraft = {
  enabled: boolean;
  dailyTarget: string;
  leewayPct: string;
  allowedMissedDays: string;
  demotionUnit: VsSequenceRule["unit"];
  demotionLength: string;
  promotionUnit: VsSequenceRule["unit"];
  promotionLength: string;
  effectiveWeek: string;
};

export function vsPolicyEditorDraft(previous: VsPolicyVersion | null, now: Date): VsPolicyEditorDraft {
  const earliest = firstFullVsWeek(now);
  const effectiveWeek = previous && previous.effectiveWeek > earliest ? previous.effectiveWeek : earliest;
  if (previous?.modelVersion === 2) {
    return {
      enabled: previous.enabled,
      dailyTarget: String(previous.dailyTarget),
      leewayPct: String(previous.leewayPct),
      allowedMissedDays: String(previous.allowedMissedDays),
      demotionUnit: previous.demotion.unit,
      demotionLength: String(previous.demotion.length),
      promotionUnit: previous.promotion.unit,
      promotionLength: String(previous.promotion.length),
      effectiveWeek,
    };
  }
  return {
    enabled: false,
    dailyTarget: String(previous?.dailyTarget ?? 7_200_000),
    leewayPct: String(previous?.leewayPct ?? 0),
    allowedMissedDays: "0",
    demotionUnit: "weeks",
    demotionLength: "1",
    promotionUnit: "weeks",
    promotionLength: "2",
    effectiveWeek,
  };
}

const integer = (value: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export function vsPolicyPatchFromDraft(draft: VsPolicyEditorDraft): Record<string, unknown> | null {
  const dailyTarget = integer(draft.dailyTarget, 1, Number.MAX_SAFE_INTEGER);
  const leewayPct = integer(draft.leewayPct, 0, 100);
  const allowedMissedDays = integer(draft.allowedMissedDays, 0, 5);
  const demotionLength = integer(draft.demotionLength, 1, draft.demotionUnit === "days" ? 312 : 52);
  const promotionLength = integer(draft.promotionLength, 1, draft.promotionUnit === "days" ? 312 : 52);
  if (dailyTarget === null || leewayPct === null || allowedMissedDays === null || demotionLength === null || promotionLength === null) return null;
  return {
    modelVersion: 2,
    enabled: draft.enabled,
    dailyTarget,
    leewayPct,
    allowedMissedDays,
    demotion: { unit: draft.demotionUnit, length: demotionLength },
    promotion: { unit: draft.promotionUnit, length: promotionLength },
    effectiveWeek: draft.effectiveWeek,
  };
}

export type VsPolicyPreviewRow = {
  memberId: string;
  memberName: string;
  currentRank: number | null;
  outcome: "passed" | "excused" | "waived" | "missed" | "pending_data" | "not_eligible";
  counts: { required: number; met: number; missed: number; excused: number; unknown: number } | null;
  recommendationKind: "none" | "demote" | "remove" | "leadership_review";
  recommendationTargetRank: number | null;
  signal: { kind: "none" | "concern" | "promotion"; targetRank: number | null; reached: boolean } | null;
};

export const VS_PREVIEW_OUTCOME_KEYS: Record<VsPolicyPreviewRow["outcome"], "meeting" | "below" | "needsEvidence" | "excused" | "waived" | "notEvaluated"> = {
  passed: "meeting",
  missed: "below",
  pending_data: "needsEvidence",
  excused: "excused",
  waived: "waived",
  not_eligible: "notEvaluated",
};

export function vsPreviewIncomplete(rows: readonly VsPolicyPreviewRow[]): boolean {
  return rows.some((row) => row.outcome === "pending_data");
}
