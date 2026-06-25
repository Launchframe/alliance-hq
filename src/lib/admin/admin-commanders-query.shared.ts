export const ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT = 25;
export const ADMIN_COMMANDERS_PAGE_SIZE_MAX = 100;

export type AdminCommandersQueryParams = {
  q?: string;
  page: number;
  limit: number;
  allianceId?: string;
  status?: string;
  ashedMemberId?: string;
  detailAllianceId?: string;
};

export function parseAdminCommandersQueryParams(
  searchParams: URLSearchParams,
): AdminCommandersQueryParams {
  const qRaw = searchParams.get("q")?.trim();
  const q = qRaw ? qRaw : undefined;

  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const limitRaw = Number.parseInt(
    searchParams.get("limit") ?? String(ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT),
    10,
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.min(ADMIN_COMMANDERS_PAGE_SIZE_MAX, Math.max(1, limitRaw))
    : ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT;

  return {
    q,
    page,
    limit,
    allianceId: searchParams.get("allianceId")?.trim() || undefined,
    status: searchParams.get("status")?.trim() || undefined,
    ashedMemberId: searchParams.get("ashedMemberId")?.trim() || undefined,
    detailAllianceId:
      searchParams.get("detailAllianceId")?.trim() || undefined,
  };
}

export function buildAdminCommandersSearchParams(
  params: AdminCommandersQueryParams,
): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.page > 1) qs.set("page", String(params.page));
  if (params.limit !== ADMIN_COMMANDERS_PAGE_SIZE_DEFAULT) {
    qs.set("limit", String(params.limit));
  }
  if (params.allianceId) qs.set("allianceId", params.allianceId);
  if (params.status) qs.set("status", params.status);
  if (params.ashedMemberId) qs.set("ashedMemberId", params.ashedMemberId);
  if (params.detailAllianceId) {
    qs.set("detailAllianceId", params.detailAllianceId);
  }
  return qs.toString();
}
