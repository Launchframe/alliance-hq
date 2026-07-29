import {
  busterDayWeekDates,
  busterDayWeekMondayForDate,
} from "@/lib/vs-performance/buster-day.shared";
import {
  isAllianceKillsVideoTarget,
  isMemberRosterVideoTarget,
} from "@/lib/video/score-targets";

export type BusterDaySnapshotAttachPlan = {
  kind: "pre" | "post";
  vsWeekMonday: string;
  jobField: "rosterJobId" | "killsJobId";
};

/**
 * Decide whether a successful video submit should bookkeep against this week's
 * Buster Day report. Only Fri (pre) / Sun (post) snapshot dates attach; the
 * date is the job's recorded date when present, otherwise Server Time today.
 */
export function resolveBusterDaySnapshotAttach(input: {
  scoreTargetId: string;
  /** Server Time YYYY-MM-DD (today). */
  serverDate: string;
  /** Job recorded date when the upload form collected one. */
  recordedDate?: string | null;
}): BusterDaySnapshotAttachPlan | null {
  const isRoster = isMemberRosterVideoTarget(input.scoreTargetId);
  const isKills = isAllianceKillsVideoTarget(input.scoreTargetId);
  if (!isRoster && !isKills) return null;

  const anchorDate = input.recordedDate?.trim() || input.serverDate;
  const vsWeekMonday = busterDayWeekMondayForDate(anchorDate);
  const week = busterDayWeekDates(vsWeekMonday);

  let kind: "pre" | "post" | null = null;
  if (anchorDate === week.friday) kind = "pre";
  else if (anchorDate === week.sunday) kind = "post";
  if (!kind) return null;

  return {
    kind,
    vsWeekMonday,
    jobField: isRoster ? "rosterJobId" : "killsJobId",
  };
}
