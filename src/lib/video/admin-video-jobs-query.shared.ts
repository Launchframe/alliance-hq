/**
 * Parse ?status= for GET /api/admin/video-jobs.
 *
 * - Omitted: default failed triage view (legacy).
 * - "all" or "": no status filter.
 * - Otherwise: exact video_jobs.status match.
 */
export function parseAdminVideoJobsStatusFilter(
  statusParam: string | null,
): string | null {
  if (statusParam === null) {
    return "failed";
  }
  if (statusParam === "all" || statusParam === "") {
    return null;
  }
  return statusParam;
}
