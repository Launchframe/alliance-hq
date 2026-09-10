import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { VsComplianceError, type VsPolicy, type VsPolicyVersion } from "./types.shared";

export function defaultVsPolicy(): VsPolicy {
  return { enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null, leewayPct: 0, preset: "rank_aware", removalThreshold: 3 };
}

export function firstFullVsWeek(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new VsComplianceError("invalid_policy");
  const monday = getWeekStartMonday(getServerCalendarDate(now));
  return addCalendarDays(monday, 13);
}

export function validateVsPolicy(policy: VsPolicy): void {
  const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (typeof policy.enabled !== "boolean" || !positive(policy.dailyTarget) ||
    policy.weeklyMinimum !== null && !positive(policy.weeklyMinimum) ||
    policy.enabled && policy.weeklyMinimum === null ||
    !Number.isInteger(policy.leewayPct) || policy.leewayPct < 0 || policy.leewayPct > 100 ||
    !["rank_aware", "consecutive"].includes(policy.preset) ||
    !positive(policy.removalThreshold) || policy.removalThreshold < 3 || policy.removalThreshold > 2_147_483_647) {
    throw new VsComplianceError("invalid_policy");
  }
}

export function mergeVsPolicyPatch(previous: VsPolicyVersion | null, patch: unknown, now: Date): VsPolicyVersion {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new VsComplianceError("invalid_policy");
  const allowed = new Set([...Object.keys(defaultVsPolicy()), "effectiveWeek"]);
  if (Object.entries(patch).some(([key, value]) => !allowed.has(key) || value === undefined)) throw new VsComplianceError("invalid_policy");
  const earliest = firstFullVsWeek(now);
  const effectiveWeek = previous && previous.effectiveWeek > earliest ? previous.effectiveWeek : earliest;
  const next = { ...(previous ?? defaultVsPolicy()), effectiveWeek, ...patch, version: (previous?.version ?? 0) + 1 } as VsPolicyVersion;
  validateVsPolicy(next);
  if (!validateVsPeriod(next.effectiveWeek, "weekly") || next.effectiveWeek < effectiveWeek) throw new VsComplianceError("invalid_policy");
  return next;
}

export function policyForVsWeek(history: readonly VsPolicyVersion[], weekEnding: string): VsPolicyVersion | null {
  if (!validateVsPeriod(weekEnding, "weekly")) throw new VsComplianceError("invalid_week");
  return history.filter((policy) => policy.effectiveWeek <= weekEnding)
    .sort((a, b) => b.effectiveWeek.localeCompare(a.effectiveWeek) || b.version - a.version)[0] ?? null;
}

export function vsWeeklyThreshold(minimum: number, leewayPct: number): number {
  validateVsPolicy({ ...defaultVsPolicy(), weeklyMinimum: minimum, leewayPct });
  return Number((BigInt(minimum) * BigInt(100 - leewayPct) + BigInt(99)) / BigInt(100));
}
