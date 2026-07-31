export const CONDUCTOR_HISTORY_DEFAULT_LIMIT = 30;
export const CONDUCTOR_HISTORY_MAX_LIMIT = 100;

export type ConductorHistoryQueryParams = {
  limit: number;
  offset: number;
  dateFrom?: string;
  dateTo?: string;
  memberId?: string;
  allianceRank?: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseConductorHistoryQueryParams(
  searchParams: URLSearchParams,
): ConductorHistoryQueryParams {
  const limitParam = Number(
    searchParams.get("limit") ?? CONDUCTOR_HISTORY_DEFAULT_LIMIT,
  );
  const offsetParam = Number(searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(limitParam)
    ? Math.min(
        Math.max(1, Math.floor(limitParam)),
        CONDUCTOR_HISTORY_MAX_LIMIT,
      )
    : CONDUCTOR_HISTORY_DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetParam)
    ? Math.max(0, Math.floor(offsetParam))
    : 0;

  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;
  const memberId = searchParams.get("memberId")?.trim() || undefined;
  const rankParam = searchParams.get("allianceRank");
  const allianceRank =
    rankParam != null && rankParam !== "" && Number.isFinite(Number(rankParam))
      ? Math.floor(Number(rankParam))
      : undefined;

  return {
    limit,
    offset,
    ...(dateFrom && DATE_RE.test(dateFrom) ? { dateFrom } : {}),
    ...(dateTo && DATE_RE.test(dateTo) ? { dateTo } : {}),
    ...(memberId ? { memberId } : {}),
    ...(allianceRank != null && allianceRank >= 1 && allianceRank <= 5
      ? { allianceRank }
      : {}),
  };
}
