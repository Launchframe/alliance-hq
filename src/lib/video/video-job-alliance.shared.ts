/** True when the job's HQ alliance differs from the viewer's current HQ alliance. */
export function isVideoJobAllianceStale(input: {
  jobHqAllianceId: string | null | undefined;
  sessionCurrentAllianceId: string | null | undefined;
  hasParseSession: boolean;
}): boolean {
  const jobHq = input.jobHqAllianceId?.trim();
  const current = input.sessionCurrentAllianceId?.trim();
  if (!input.hasParseSession || !jobHq || !current) return false;
  return jobHq !== current;
}

export const VIDEO_JOB_ALLIANCE_UNRESOLVED_CODE = "job_alliance_unresolved";

export const VIDEO_JOB_ALLIANCE_UNRESOLVED_ERROR =
  "Couldn't load this job's alliance roster. Please refresh the page.";
