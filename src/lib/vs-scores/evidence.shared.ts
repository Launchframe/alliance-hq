import { addCalendarDays } from "@/lib/trains/game-time";

export type VsPeriod = "daily" | "weekly";
export type VsEvidence = { id: string; recordedDate: string; period: VsPeriod; score: number };
export type VsWeekEvidence = {
  state: "ready" | "missing" | "partial" | "conflict";
  score: number | null;
  source: "weekly" | "daily" | null;
  dailyCoverage: number;
  basis: string[];
  derivedSaturday: { score: number; basis: string[] } | null;
};

export function mergeVsDailySources(local: ReadonlyArray<{ memberId: string; score: number | null; origin: "hq" | "derived" }>, remote: ReadonlyMap<string, number>, managed: Record<string, { previous: number | null; desired: number | null }> = {}): Map<string, number> {
  const scores = new Map(remote);
  for (const row of local) {
    const previous = Object.hasOwn(managed, row.memberId) ? managed[row.memberId] : undefined;
    const upstream = remote.get(row.memberId);
    const owned = previous && (upstream === previous.previous || upstream === previous.desired);
    if (row.origin === "derived" && upstream != null && !owned) continue;
    if (row.score == null) scores.delete(row.memberId); else scores.set(row.memberId, row.score);
  }
  return scores;
}

export class VsEvidenceError extends Error {
  constructor(public readonly code: "invalid_score" | "invalid_period" | "invalid_member" | "invalid_rows" | "stale" | "forbidden", public readonly status = 400) { super(code); }
}

export function parseVsScore(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string") throw new VsEvidenceError("invalid_score");
  const text = value.trim();
  if (!/^\d+$/.test(text) && !/^\d{1,3}(?:,\d{3})+$/.test(text) && !/^\d{1,3}(?:\.\d{3})+$/.test(text) && !/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+$/.test(text)) throw new VsEvidenceError("invalid_score");
  const score = Number(text.replace(/[,. \u00a0\u202f]/g, ""));
  if (!Number.isSafeInteger(score) || score < 0) throw new VsEvidenceError("invalid_score");
  return score;
}

export function validateVsPeriod(date: string, period: string): period is VsPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (period !== "daily" && period !== "weekly")) return false;
  const instant = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) return false;
  return (instant.getUTCDay() === 0) === (period === "weekly");
}

export function vsWeekEndingDate(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, (7 - day) % 7);
}

export function evaluateVsWeek(records: readonly VsEvidence[], weekEnding: string): VsWeekEvidence {
  if (!validateVsPeriod(weekEnding, "weekly")) throw new VsEvidenceError("invalid_period");
  const days = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));
  const relevant = records.filter((row) => row.period === "weekly" ? row.recordedDate === weekEnding : days.includes(row.recordedDate));
  const byDate = new Map<string, VsEvidence>();
  let conflict = false;
  for (const record of relevant) {
    if (!Number.isSafeInteger(record.score) || record.score < 0) { conflict = true; continue; }
    const key = `${record.period}:${record.recordedDate}`;
    const previous = byDate.get(key);
    if (previous && previous.score !== record.score) conflict = true;
    else if (!previous) byDate.set(key, record);
  }
  const daily = days.flatMap((date) => { const row = byDate.get(`daily:${date}`); return row ? [row] : []; });
  const weekly = byDate.get(`weekly:${weekEnding}`);
  const knownTotal = daily.reduce((sum, row) => sum + row.score, 0);
  if (!Number.isSafeInteger(knownTotal) || weekly && (knownTotal > weekly.score || daily.length === 6 && knownTotal !== weekly.score)) conflict = true;
  const result: VsWeekEvidence = {
    state: conflict ? "conflict" : weekly || daily.length === 6 ? "ready" : daily.length ? "partial" : "missing",
    score: conflict ? null : weekly?.score ?? (daily.length === 6 ? knownTotal : null),
    source: conflict ? null : weekly ? "weekly" : daily.length === 6 ? "daily" : null,
    dailyCoverage: daily.length, basis: relevant.map((row) => row.id), derivedSaturday: null,
  };
  const firstFive = days.slice(0, 5).map((date) => byDate.get(`daily:${date}`));
  if (!conflict && weekly && !byDate.has(`daily:${days[5]}`) && firstFive.every((row) => row != null)) {
    result.derivedSaturday = { score: weekly.score - firstFive.reduce((sum, row) => sum + row!.score, 0), basis: [weekly.id, ...firstFive.map((row) => row!.id)] };
  }
  return result;
}
