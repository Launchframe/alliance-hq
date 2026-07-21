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

/** UI filters for /admin/video-jobs (persisted in the URL). */
export type AdminVideoJobsListFilters = {
  /** UI status including "all"; default "failed". */
  status: string;
  bucket: string;
  rating: string;
  passKey: string;
};

export const DEFAULT_ADMIN_VIDEO_JOBS_LIST_FILTERS: AdminVideoJobsListFilters = {
  status: "failed",
  bucket: "",
  rating: "",
  passKey: "",
};

type SearchParamsReader = {
  get(name: string): string | null;
};

/** Read list filters from the page or detail URL query string. */
export function parseAdminVideoJobsListFilters(
  searchParams: SearchParamsReader,
): AdminVideoJobsListFilters {
  const statusRaw = searchParams.get("status");
  return {
    status:
      statusRaw === null || statusRaw === ""
        ? DEFAULT_ADMIN_VIDEO_JOBS_LIST_FILTERS.status
        : statusRaw,
    bucket: searchParams.get("bucket")?.trim() ?? "",
    rating: searchParams.get("rating")?.trim() ?? "",
    passKey: searchParams.get("passKey")?.trim() ?? "",
  };
}

/** Build query params for the list page / inspect links (always includes status). */
export function buildAdminVideoJobsListSearchParams(
  filters: AdminVideoJobsListFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("status", filters.status || DEFAULT_ADMIN_VIDEO_JOBS_LIST_FILTERS.status);
  if (filters.bucket) params.set("bucket", filters.bucket);
  if (filters.rating) params.set("rating", filters.rating);
  if (filters.passKey) params.set("passKey", filters.passKey);
  return params;
}

export function videoJobsListHref(
  listPath: string,
  filters: AdminVideoJobsListFilters,
): string {
  const qs = buildAdminVideoJobsListSearchParams(filters).toString();
  return `${listPath}?${qs}`;
}

export function videoJobDetailHref(
  listPath: string,
  jobId: string,
  filters: AdminVideoJobsListFilters,
): string {
  const qs = buildAdminVideoJobsListSearchParams(filters).toString();
  return `${listPath}/${jobId}?${qs}`;
}

export function adminVideoJobsListHref(
  filters: AdminVideoJobsListFilters,
): string {
  return videoJobsListHref("/admin/video-jobs", filters);
}

export function adminVideoJobDetailHref(
  jobId: string,
  filters: AdminVideoJobsListFilters,
): string {
  return videoJobDetailHref("/admin/video-jobs", jobId, filters);
}
