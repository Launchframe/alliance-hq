import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";
import { VsPerformanceError, isVsCalendarDate, vsDatesForWeek } from "./weekly-plan.shared";

export type WeeklyPifCandidate = { memberId: string; memberName: string };
export type WeeklyPifDay = {
  scoreDate: string;
  trainDate: string;
  isPifWeekday: boolean;
  scores: ReadonlyMap<string, number>;
  eligibleMemberIds: ReadonlySet<string>;
};
export type WeeklyPifEntry = WeeklyPifCandidate & {
  rank: number;
  averageScore: number;
  averageExcess: number;
  totalExcess: string;
  daysCounted: number;
  isViewer: boolean;
};
export type WeeklyPifBoard = {
  weekStart: string;
  scheduledDates: string[];
  countedDates: string[];
  missingDates: string[];
  provisional: boolean;
  entries: WeeklyPifEntry[];
  podium: WeeklyPifEntry[];
  remaining: WeeklyPifEntry[];
};

export function buildWeeklyPifBoard(input: {
  weekStart: string;
  serverToday: string;
  candidates: readonly WeeklyPifCandidate[];
  days: readonly WeeklyPifDay[];
  viewerMemberId?: string | null;
}): WeeklyPifBoard {
  const dates = vsDatesForWeek(input.weekStart);
  if (!isVsCalendarDate(input.serverToday)) throw new VsPerformanceError("invalid");
  const seen = new Set<string>();
  for (const day of input.days) {
    if (!dates.includes(day.scoreDate) || !isVsCalendarDate(day.trainDate) || seen.has(day.scoreDate)) throw new VsPerformanceError("invalid");
    seen.add(day.scoreDate);
    for (const score of day.scores.values()) {
      if (!Number.isSafeInteger(score) || score < 0) throw new VsPerformanceError("invalid");
    }
  }
  if (seen.size !== dates.length) throw new VsPerformanceError("invalid");
  const scheduled = input.days.filter((day) => day.isPifWeekday).sort((a, b) => a.scoreDate < b.scoreDate ? -1 : a.scoreDate > b.scoreDate ? 1 : 0);
  const counted = scheduled.filter((day) => day.scoreDate < input.serverToday && day.scores.size > 0);
  const countedDates = counted.map((day) => day.scoreDate);
  const missingDates = scheduled.filter((day) => !countedDates.includes(day.scoreDate)).map((day) => day.scoreDate);
  const members = new Set<string>();
  const ranked: Array<WeeklyPifCandidate & { excess: bigint }> = [];
  for (const candidate of input.candidates) {
    if (members.has(candidate.memberId)) throw new VsPerformanceError("invalid");
    members.add(candidate.memberId);
    if (!counted.length) continue;
    let excess = BigInt(0);
    let eligible = true;
    for (const day of counted) {
      const score = day.scores.get(candidate.memberId);
      if (!day.eligibleMemberIds.has(candidate.memberId) || score == null || score < PRICE_IS_RIGHT_MIN_VS_SCORE) {
        eligible = false;
        break;
      }
      excess += BigInt(score) - BigInt(PRICE_IS_RIGHT_MIN_VS_SCORE);
    }
    if (eligible) ranked.push({ ...candidate, excess });
  }
  ranked.sort((a, b) => a.excess < b.excess ? -1 : a.excess > b.excess ? 1
    : a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1
      : a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);
  const entries = ranked.slice(0, 10).map((entry, index): WeeklyPifEntry => {
    const averageExcess = Number(entry.excess) / counted.length;
    return {
      rank: index + 1,
      memberId: entry.memberId,
      memberName: entry.memberName,
      totalExcess: entry.excess.toString(),
      averageExcess,
      averageScore: PRICE_IS_RIGHT_MIN_VS_SCORE + averageExcess,
      daysCounted: counted.length,
      isViewer: entry.memberId === input.viewerMemberId,
    };
  });
  return {
    weekStart: input.weekStart,
    scheduledDates: scheduled.map((day) => day.scoreDate),
    countedDates,
    missingDates,
    provisional: missingDates.length > 0,
    entries,
    podium: entries.slice(0, 3),
    remaining: entries.slice(3),
  };
}
