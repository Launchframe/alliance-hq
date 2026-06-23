export const ADMIN_USERS_PAGE_SIZE_DEFAULT = 25;
export const ADMIN_USERS_PAGE_SIZE_MAX = 100;

export type AdminUsersQueryParams = {
  q?: string;
  page: number;
  limit: number;
  allianceId?: string;
  hqUserId?: string;
  platformMaintainersOnly: boolean;
};

export function parseAdminUsersQueryParams(
  searchParams: URLSearchParams,
): AdminUsersQueryParams {
  const qRaw = searchParams.get("q")?.trim();
  const q = qRaw ? qRaw : undefined;

  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const limitRaw = Number.parseInt(
    searchParams.get("limit") ?? String(ADMIN_USERS_PAGE_SIZE_DEFAULT),
    10,
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.min(ADMIN_USERS_PAGE_SIZE_MAX, Math.max(1, limitRaw))
    : ADMIN_USERS_PAGE_SIZE_DEFAULT;

  const allianceId = searchParams.get("allianceId")?.trim() || undefined;
  const hqUserId = searchParams.get("hqUserId")?.trim() || undefined;
  const platformMaintainersOnly = searchParams.get("platformMaintainers") === "1";

  return { q, page, limit, allianceId, hqUserId, platformMaintainersOnly };
}

export function buildAdminUsersSearchParams(
  params: AdminUsersQueryParams,
): string {
  const qs = new URLSearchParams();
  if (params.q) {
    qs.set("q", params.q);
  }
  if (params.page > 1) {
    qs.set("page", String(params.page));
  }
  if (params.limit !== ADMIN_USERS_PAGE_SIZE_DEFAULT) {
    qs.set("limit", String(params.limit));
  }
  if (params.allianceId) {
    qs.set("allianceId", params.allianceId);
  }
  if (params.hqUserId) {
    qs.set("hqUserId", params.hqUserId);
  }
  if (params.platformMaintainersOnly) {
    qs.set("platformMaintainers", "1");
  }
  return qs.toString();
}
