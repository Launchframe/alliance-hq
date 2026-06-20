import { getScoreTarget } from "@/lib/video/score-targets";

/** HQ nav href → enabled score target id (iframe event / recurring pages). */
export const SCORE_TARGET_BY_NAV_HREF: Readonly<Record<string, string>> = {
  "/desert-storm": "desert-storm",
  "/canyon-storm": "canyon-storm",
  "/zombie-siege": "zombie-siege",
  "/alliance-exercise": "alliance-exercise",
  "/vs-performance": "vs-performance",
  "/donations": "donations",
  "/seasonal-events": "seasonal",
};

export function getScoreTargetIdForNavHref(href: string): string | null {
  const id = SCORE_TARGET_BY_NAV_HREF[href];
  if (!id) return null;
  return getScoreTarget(id)?.enabled ? id : null;
}

export function buildVideoUploadHref(scoreTargetId: string): string {
  return `/tools/video-upload?scoreTarget=${encodeURIComponent(scoreTargetId)}`;
}

export function resolveJobScoreTarget(job: {
  scoreTarget?: string | null;
  category?: string | null;
}): string | null {
  return job.scoreTarget ?? job.category ?? null;
}

export function jobMatchesScoreTarget(
  job: { scoreTarget?: string | null; category?: string | null },
  scoreTargetId: string,
): boolean {
  return resolveJobScoreTarget(job) === scoreTargetId;
}

export function parseVideoUploadScoreTargetParam(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const target = getScoreTarget(trimmed);
  return target?.enabled ? target.id : null;
}
