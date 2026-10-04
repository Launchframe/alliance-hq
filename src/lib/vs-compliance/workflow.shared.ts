import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { VsComplianceError } from "./types.shared";

export function lastClosedVsWeek(now = new Date()): string {
  const today = getServerCalendarDate(now);
  return validateVsPeriod(today, "weekly") ? today : addCalendarDays(getWeekStartMonday(today), -1);
}

export function complianceWeeks(first: string, last: string): string[] {
  if (!validateVsPeriod(first, "weekly") || !validateVsPeriod(last, "weekly")) throw new VsComplianceError("invalid_week");
  const weeks: string[] = [];
  for (let week = first; week <= last; week = addCalendarDays(week, 7)) {
    if (weeks.length >= 520) throw new VsComplianceError("changed", 409);
    weeks.push(week);
  }
  return weeks;
}

export function resolveComplianceJoin(currentStints: readonly string[], joinDate: string | null): string | null {
  const dates = currentStints.map(Date.parse).filter(Number.isFinite);
  if (joinDate) {
    const date = Date.parse(joinDate.length === 10 ? `${joinDate}T02:00:00.000Z` : joinDate);
    if (Number.isFinite(date)) dates.push(date);
  }
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

export function planComplianceMirror(action: { kind: string; expectedRank: number | null; targetRank: number | null }, remote: { rank: number | null; status: string }): "verified" | "write_rank" | "conflict" {
  if (action.kind === "remove") return remote.status === "former" ? "verified" : "conflict";
  if (remote.status !== "active" || remote.rank === null || remote.rank === 5) return "conflict";
  if (remote.rank === action.targetRank) return "verified";
  return remote.rank === action.expectedRank ? "write_rank" : "conflict";
}

export function validateComplianceCommand(body: unknown, waiver: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new VsComplianceError("changed", 409);
  const row = body as Record<string, unknown>;
  if (typeof row.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(row.requestId) || typeof row.confirmationBasis !== "string" || !/^[a-f0-9]{64}$/.test(row.confirmationBasis)) throw new VsComplianceError("changed", 409);
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (waiver && (!reason || reason.length > 2000)) throw new VsComplianceError("reason_required");
  return { requestId: row.requestId, confirmationBasis: row.confirmationBasis, reason: waiver ? reason : null };
}
