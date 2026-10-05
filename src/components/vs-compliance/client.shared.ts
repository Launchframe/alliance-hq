import type { loadComplianceDashboard } from "@/lib/vs-compliance/service.server";
import type { loadVsMembershipSettings } from "@/lib/vs-compliance/policy.server";
import type { VsComplianceHistory, VsPolicyVersion } from "@/lib/vs-compliance/types.shared";
import { validateVsPolicy } from "@/lib/vs-compliance/policy.shared";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import type { VsPolicyPreviewRow } from "@/lib/vs-compliance/policy-editor.shared";
import { addCalendarDays } from "@/lib/trains/game-time";

export type ComplianceDashboard = Awaited<ReturnType<typeof loadComplianceDashboard>>;
export type ComplianceRow = ComplianceDashboard["rows"][number];
export type MembershipSettings = Awaited<ReturnType<typeof loadVsMembershipSettings>> & { canManage: boolean };
export type ConfirmationTarget = Pick<ComplianceRow, "id" | "memberId" | "memberName" | "weekEnding" | "confirmationBasis">;

export type ActionAttempt = {
  row: ConfirmationTarget;
  operation: "complete" | "waive";
  requestId: string;
  reason: string;
};

export function createActionAttempt<T extends ConfirmationTarget>(row: T, operation: ActionAttempt["operation"], reason: string, requestId = crypto.randomUUID()): ActionAttempt & { row: T } {
  return { row: structuredClone(row), operation, requestId, reason: reason.trim() };
}

export function actionBody(attempt: ActionAttempt) {
  return {
    confirmationBasis: attempt.row.confirmationBasis,
    requestId: attempt.requestId,
    ...(attempt.operation === "waive" ? { reason: attempt.reason } : {}),
  };
}

export function syncLabel(status: unknown): "localOnly" | "pending" | "synced" | "credentialsRequired" | "failed" {
  if (status === "local") return "localOnly";
  if (status === "pending" || status === "synced") return status;
  if (status === "credentials_required") return "credentialsRequired";
  return "failed";
}

export class ComplianceClientError extends Error {
  constructor(message: string, public readonly code: string, public readonly uncertain: boolean) { super(message); }
}

export async function readComplianceResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  const data = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!response.ok || !data) {
    throw new ComplianceClientError(typeof data?.error === "string" ? data.error : fallback, typeof data?.code === "string" ? data.code : "failed", response.status >= 500 || !data);
  }
  return data;
}

export function isComplianceHistory(data: Record<string, unknown>): data is Record<string, unknown> & VsComplianceHistory {
  const rank = (value: unknown) => value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
  const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  return typeof data.eventId === "string" && typeof data.memberId === "string" && typeof data.memberName === "string" && typeof data.weekEnding === "string" && validateVsPeriod(data.weekEnding, "weekly") && Array.isArray(data.actions) && data.actions.every((action) => action && typeof action.id === "string" && typeof action.actorId === "string" && (action.actorName === null || typeof action.actorName === "string") && ["waive", "demote", "remove"].includes(action.kind) && rank(action.expectedRank) && rank(action.targetRank) && (action.reason === null || typeof action.reason === "string") && instant(action.recordedAt) && typeof action.correctionReview === "boolean" && Array.isArray(action.reviewDates) && action.reviewDates.every(instant) && [null, "local", "pending", "synced", "failed", "credentials_required"].includes(action.syncStatus) && (action.supersededAt === null || instant(action.supersededAt)));
}

export function isDashboard(data: Record<string, unknown>): data is Record<string, unknown> & ComplianceDashboard {
  const nullableNumber = (value: unknown) => value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return typeof data.weekEnding === "string" && validateVsPeriod(data.weekEnding, "weekly") && typeof data.canManage === "boolean" && Array.isArray(data.rows) && data.rows.every((row) => row && typeof row.id === "string" && typeof row.memberId === "string" && typeof row.memberName === "string" && row.weekEnding === data.weekEnding && typeof row.dailyTarget === "number" && Number.isSafeInteger(row.dailyTarget) && row.dailyTarget > 0 && Array.isArray(row.daily) && row.daily.length === 6 && row.daily.every((day: ComplianceRow["daily"][number], index: number) => day && day.date === addCalendarDays(row.weekEnding, index - 6) && nullableNumber(day.score) && ["ready", "missing", "partial", "conflict"].includes(day.state) && (day.state === "ready" ? day.score !== null : day.score === null) && [null, "hq", "ashed", "derived"].includes(day.source) && typeof day.sourceReady === "boolean" && typeof day.away === "boolean" && typeof day.excused === "boolean" && typeof day.pendingExcusal === "boolean") && typeof row.confirmationBasis === "string" && typeof row.evaluationBasis === "string" && typeof row.syncStatus === "string" && typeof row.correctionReview === "boolean" && nullableNumber(row.score) && nullableNumber(row.threshold) && nullableNumber(row.currentRank) && nullableNumber(row.streak) && nullableNumber(row.policyVersion) && ["ready", "missing", "partial", "conflict"].includes(row.evidenceState) && ["passed", "excused", "waived", "missed", "pending_data", "not_eligible"].includes(row.outcome) && row.recommendation && nullableNumber(row.recommendation.targetRank) && ["none", "demote", "remove", "leadership_review"].includes(row.recommendation.kind) && (row.settled === null || row.settled && typeof row.settled.actionId === "string" && nullableNumber(row.settled.targetRank)));
}

export function isPolicy(value: unknown): value is VsPolicyVersion {
  if (!value || typeof value !== "object") return false;
  const policy = value as VsPolicyVersion;
  try { validateVsPolicy(policy); } catch { return false; }
  return Number.isSafeInteger(policy.version) && policy.version > 0 && typeof policy.effectiveWeek === "string" && validateVsPeriod(policy.effectiveWeek, "weekly");
}

export type VsPolicyPreviewResponse = { weekEnding: string; rows: VsPolicyPreviewRow[] };

export function isPolicyPreview(data: Record<string, unknown>): data is Record<string, unknown> & VsPolicyPreviewResponse {
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const rank = (value: unknown) => value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
  if (typeof data.weekEnding !== "string" || !validateVsPeriod(data.weekEnding, "weekly") || !Array.isArray(data.rows)) return false;
  return data.rows.every((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const value = row as Partial<VsPolicyPreviewRow>;
    if (typeof value.memberId !== "string" || typeof value.memberName !== "string" || !rank(value.currentRank) ||
      !["passed", "excused", "waived", "missed", "pending_data", "not_eligible"].includes(value.outcome ?? "") ||
      !(value.counts === null || value.counts && count(value.counts.required) && count(value.counts.met) && count(value.counts.missed) && count(value.counts.excused) && count(value.counts.unknown)) ||
      !["none", "demote", "remove", "leadership_review"].includes(value.recommendationKind ?? "") ||
      typeof value.signal?.reached !== "boolean" && value.signal !== null) return false;
    if (value.recommendationKind === "demote") {
      if (typeof value.currentRank !== "number" || value.currentRank < 2 || value.currentRank > 4 || value.recommendationTargetRank !== value.currentRank - 1) return false;
    } else if (value.recommendationKind === "remove") {
      if (value.currentRank !== 1 || value.recommendationTargetRank !== null) return false;
    } else if (value.recommendationTargetRank !== null) return false;
    if (value.signal === null) return true;
    if (!value.signal || !["none", "concern", "promotion"].includes(value.signal.kind ?? "")) return false;
    if (value.signal.kind === "promotion") return (value.currentRank === 1 || value.currentRank === 2) && value.signal.targetRank === value.currentRank + 1;
    return value.signal.targetRank === null;
  });
}

export function isMembershipSettings(data: Record<string, unknown>): data is Record<string, unknown> & MembershipSettings {
  if (!data.defaults || typeof data.defaults !== "object") return false;
  try { validateVsPolicy(data.defaults as MembershipSettings["defaults"]); } catch { return false; }
  return typeof data.canManage === "boolean" && Array.isArray(data.history) && data.history.every(isPolicy) && (data.latest === null || isPolicy(data.latest));
}

export class RequestVersion {
  private version = 0;
  next() { return ++this.version; }
  current(version: number) { return version === this.version; }
}
