import "server-only";

import { loadRecentCompletedVideoJobTimes } from "@/lib/analytics/snapshots.server";
import {
  getServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import { buildVideoUploadHref } from "@/lib/video/score-target-nav";

export type VideoUploadCoverageTarget = {
  id: string;
  labelKey: string;
  lookbackHours: number;
  satisfied: boolean;
  uploadHref: string;
  weekendOnly?: boolean;
};

const CORE_TARGETS = [
  {
    id: "vs-performance",
    labelKey: "vsPerformance",
    uploadHref: buildVideoUploadHref("vs-performance"),
  },
  {
    id: "donations",
    labelKey: "donations",
    uploadHref: buildVideoUploadHref("donations"),
  },
  {
    id: "alliance-exercise",
    labelKey: "allianceExercise",
    uploadHref: buildVideoUploadHref("alliance-exercise"),
  },
  {
    id: "zombie-siege",
    labelKey: "zombieSiege",
    uploadHref: buildVideoUploadHref("zombie-siege"),
  },
  {
    id: "alliance-kills-video",
    labelKey: "allianceKillsVideo",
    uploadHref: buildVideoUploadHref("alliance-kills-video"),
  },
] as const;

const WEEKEND_EVENT_TARGET = {
  id: "weekend-event",
  labelKey: "weekendEvent",
  uploadHref: buildVideoUploadHref("vs-performance"),
} as const;

export function resolveVsPerformanceLookbackHours(today = getServerCalendarDate()): number {
  return getServerDayOfWeek(today) === 1 ? 48 : 24;
}

export function isWeekendServerDay(today = getServerCalendarDate()): boolean {
  const dow = getServerDayOfWeek(today);
  return dow === 0 || dow === 6;
}

function targetSatisfiedSince(
  jobTimes: Map<string, Date>,
  targetId: string,
  since: Date,
): boolean {
  const completedAt = jobTimes.get(targetId);
  return completedAt != null && completedAt >= since;
}

export async function loadVideoUploadCoverage(
  allianceId: string,
  now = new Date(),
): Promise<VideoUploadCoverageTarget[]> {
  const today = getServerCalendarDate(now);
  const vsLookbackHours = resolveVsPerformanceLookbackHours(today);
  const maxLookbackHours = Math.max(vsLookbackHours, 24);
  const sinceMax = new Date(now.getTime() - maxLookbackHours * 60 * 60 * 1000);
  const jobTimes = await loadRecentCompletedVideoJobTimes(allianceId, sinceMax);

  const targets: VideoUploadCoverageTarget[] = CORE_TARGETS.map((target) => {
    const lookbackHours =
      target.id === "vs-performance" ? vsLookbackHours : 24;
    const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
    return {
      id: target.id,
      labelKey: target.labelKey,
      lookbackHours,
      satisfied: targetSatisfiedSince(jobTimes, target.id, since),
      uploadHref: target.uploadHref,
    };
  });

  if (isWeekendServerDay(today)) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    targets.push({
      id: WEEKEND_EVENT_TARGET.id,
      labelKey: WEEKEND_EVENT_TARGET.labelKey,
      lookbackHours: 24,
      satisfied: targetSatisfiedSince(jobTimes, "vs-performance", since),
      uploadHref: WEEKEND_EVENT_TARGET.uploadHref,
      weekendOnly: true,
    });
  }

  return targets;
}
