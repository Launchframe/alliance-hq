import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { VsComplianceError, type VsDailyPolicyVersion, type VsPolicy, type VsPolicyDraft, type VsPolicyVersion, type VsSequenceRule } from "./types.shared";

export function defaultVsPolicy(): VsPolicy {
  return { enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null, leewayPct: 0, preset: "rank_aware", removalThreshold: 3 };
}

export function defaultVsDailyPolicy(): Omit<VsDailyPolicyVersion, "version" | "effectiveWeek"> {
  return { modelVersion: 2, enabled: false, dailyTarget: 7_200_000, leewayPct: 0, allowedMissedDays: 0, demotion: { unit: "weeks", length: 1 }, promotion: { unit: "weeks", length: 2 } };
}

export function firstFullVsWeek(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new VsComplianceError("invalid_policy");
  const monday = getWeekStartMonday(getServerCalendarDate(now));
  return addCalendarDays(monday, 13);
}

const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function validateVsLegacyPolicy(policy: VsPolicy): void {
  if (typeof policy.enabled !== "boolean" || !positive(policy.dailyTarget) ||
    policy.weeklyMinimum !== null && !positive(policy.weeklyMinimum) ||
    policy.enabled && policy.weeklyMinimum === null ||
    !Number.isInteger(policy.leewayPct) || policy.leewayPct < 0 || policy.leewayPct > 100 ||
    !["rank_aware", "consecutive"].includes(policy.preset) ||
    !positive(policy.removalThreshold) || policy.removalThreshold < 3 || policy.removalThreshold > 2_147_483_647) {
    throw new VsComplianceError("invalid_policy");
  }
}

function validateVsSequenceRule(rule: unknown): rule is VsSequenceRule {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
  const keys = Object.keys(rule).sort();
  if (keys.join(",") !== "length,unit") return false;
  const { unit, length } = rule as VsSequenceRule;
  if (unit !== "days" && unit !== "weeks") return false;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 1) return false;
  return length <= (unit === "days" ? 312 : 52);
}

function validateVsDailyPolicy(policy: VsPolicyDraft): void {
  const row = policy as Omit<VsDailyPolicyVersion, "version" | "effectiveWeek">;
  if (typeof row.enabled !== "boolean" || !positive(row.dailyTarget) ||
    !Number.isInteger(row.leewayPct) || row.leewayPct < 0 || row.leewayPct > 100 ||
    !Number.isInteger(row.allowedMissedDays) || row.allowedMissedDays < 0 || row.allowedMissedDays > 5 ||
    !validateVsSequenceRule(row.demotion) || !validateVsSequenceRule(row.promotion)) {
    throw new VsComplianceError("invalid_policy");
  }
}

export function validateVsPolicy(policy: VsPolicyDraft): void {
  if ((policy as { modelVersion?: number }).modelVersion === 2) validateVsDailyPolicy(policy);
  else validateVsLegacyPolicy(policy as VsPolicy);
}

export function mergeVsPolicyPatch(previous: VsPolicyVersion | null, patch: unknown, now: Date): VsPolicyVersion {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new VsComplianceError("invalid_policy");
  const row = patch as Record<string, unknown>;
  const earliest = firstFullVsWeek(now);
  const effectiveWeek = previous && previous.effectiveWeek > earliest ? previous.effectiveWeek : earliest;
  if (row.modelVersion === 2 || (row.modelVersion === undefined && previous?.modelVersion === 2)) {
    const allowed = new Set(["modelVersion", "enabled", "dailyTarget", "leewayPct", "allowedMissedDays", "demotion", "promotion", "effectiveWeek"]);
    if (Object.entries(row).some(([key, value]) => !allowed.has(key) || value === undefined)) throw new VsComplianceError("invalid_policy");
    const base: Omit<VsDailyPolicyVersion, "version" | "effectiveWeek"> = previous && previous.modelVersion === 2
      ? previous
      : { ...defaultVsDailyPolicy(), enabled: previous?.enabled ?? false, dailyTarget: previous?.dailyTarget ?? 7_200_000, leewayPct: previous?.leewayPct ?? 0 };
    const next = { ...base, effectiveWeek, ...row, modelVersion: 2, version: (previous?.version ?? 0) + 1 } as VsDailyPolicyVersion;
    validateVsPolicy(next);
    if (!validateVsPeriod(next.effectiveWeek, "weekly") || next.effectiveWeek < effectiveWeek) throw new VsComplianceError("invalid_policy");
    return next;
  }
  if (previous && previous.modelVersion === 2) throw new VsComplianceError("invalid_policy");
  const allowed = new Set([...Object.keys(defaultVsPolicy()), "modelVersion", "effectiveWeek"]);
  if (Object.entries(row).some(([key, value]) => !allowed.has(key) || value === undefined || key === "modelVersion" && value !== 1)) throw new VsComplianceError("invalid_policy");
  const { modelVersion: _ignored, ...legacyPatch } = row;
  const next = { ...(previous ?? defaultVsPolicy()), effectiveWeek, ...legacyPatch, modelVersion: 1 as const, version: (previous?.version ?? 0) + 1 } as VsPolicyVersion;
  validateVsPolicy(next);
  if (!validateVsPeriod(next.effectiveWeek, "weekly") || next.effectiveWeek < effectiveWeek) throw new VsComplianceError("invalid_policy");
  return next;
}

export function policyForVsWeek(history: readonly VsPolicyVersion[], weekEnding: string): VsPolicyVersion | null {
  if (!validateVsPeriod(weekEnding, "weekly")) throw new VsComplianceError("invalid_week");
  return history.filter((policy) => policy.effectiveWeek <= weekEnding)
    .sort((a, b) => b.effectiveWeek.localeCompare(a.effectiveWeek) || b.version - a.version)[0] ?? null;
}

export function vsThreshold(minimum: number, leewayPct: number): number {
  if (!positive(minimum) || !Number.isInteger(leewayPct) || leewayPct < 0 || leewayPct > 100) throw new VsComplianceError("invalid_policy");
  return Number((BigInt(minimum) * BigInt(100 - leewayPct) + BigInt(99)) / BigInt(100));
}

export function vsWeeklyThreshold(minimum: number, leewayPct: number): number {
  validateVsPolicy({ ...defaultVsPolicy(), weeklyMinimum: minimum, leewayPct });
  return vsThreshold(minimum, leewayPct);
}
