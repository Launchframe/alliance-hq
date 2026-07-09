import "server-only";

import {
  getServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import { loadRecentCompletedVideoTargets } from "@/lib/analytics/snapshots.server";

export type VideoUploadCoverageTarget = {
  id: string;
  labelKey: string;
  lookbackHours: number;
  satisfied: boolean;
  uploadHref: string;
  weekendOnly?: boolean;
};

const CORE_TARGETS = [
  { id: "vs-performance", labelKey: "vsPerformance", uploadHref: "/tools/video-upload?target=vs-performance" },
  { id: "donations", labelKey: "donations", uploadHref: "/tools/video-upload?target=donations" },
  {
    id: "alliance-exercise",
    labelKey: "allianceExercise",
    uploadHref: "/tools/video-upload?target=alliance-exercise",
  },
  { id: "zombie-siege", labelKey: "zombieSiege", uploadHref: "/tools/video-upload?target=zombie-siege" },
] as const;

const WEEKEND_EVENT_TARGET = {
  id: "weekend-event",
  labelKey: "weekendEvent",
  uploadHref: "/tools/video-upload?target=vs-performance",
} as const;

export function resolveVsPerformanceLookbackHours(today = getServerCalendarDate()): number {
  return getServerDayOfWeek(today) === 1 ? 48 : 24;
}

export function isWeekendServerDay(today = getServerCalendarDate()): boolean {
  const dow = getServerDayOfWeek(today);
  return dow === 0 || dow === 6;
}

export async function loadVideoUploadCoverage(
  allianceId: string,
  now = new Date(),
): Promise<VideoUploadCoverageTarget[]> {
  const today = getServerCalendarDate(now);
  const vsLookbackHours = resolveVsPerformanceLookbackHours(today);
  const targets: VideoUploadCoverageTarget[] = [];

  for (const target of CORE_TARGETS) {
    const lookbackHours =
      target.id === "vs-performance" ? vsLookbackHours : 24;
    const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
    const completed = await loadRecentCompletedVideoTargets(allianceId, since);
    targets.push({
      id: target.id,
      labelKey: target.labelKey,
      lookbackHours,
      satisfied: completed.has(target.id),
      uploadHref: target.uploadHref,
    });
  }

  if (isWeekendServerDay(today)) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const completed = await loadRecentCompletedVideoTargets(allianceId, since);
    targets.push({
      id: WEEKEND_EVENT_TARGET.id,
      labelKey: WEEKEND_EVENT_TARGET.labelKey,
      lookbackHours: 24,
      satisfied: completed.has("vs-performance"),
      uploadHref: WEEKEND_EVENT_TARGET.uploadHref,
      weekendOnly: true,
    });
  }

  return targets;
}
