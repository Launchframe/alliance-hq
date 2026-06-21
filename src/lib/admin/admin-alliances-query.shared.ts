const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;

export type AdminAlliancesOperatingMode = "native" | "ashed" | "all";
export type AdminAlliancesSort = "name" | "memberCount" | "rolesSyncedAt";
export type AdminAlliancesOrder = "asc" | "desc";

export type AdminAlliancesQueryParams = {
  q?: string;
  operatingMode: AdminAlliancesOperatingMode;
  sort: AdminAlliancesSort;
  order: AdminAlliancesOrder;
  limit: number;
  offset: number;
};

export type ParseAdminAlliancesQueryResult =
  | { ok: true; params: AdminAlliancesQueryParams }
  | { ok: false; error: string };

const OPERATING_MODES = new Set<AdminAlliancesOperatingMode>([
  "native",
  "ashed",
  "all",
]);
const SORT_FIELDS = new Set<AdminAlliancesSort>([
  "name",
  "memberCount",
  "rolesSyncedAt",
]);
const ORDER_DIRS = new Set<AdminAlliancesOrder>(["asc", "desc"]);

export function parseAdminAlliancesQueryParams(
  searchParams: URLSearchParams,
): ParseAdminAlliancesQueryResult {
  const q = searchParams.get("q")?.trim() || undefined;

  const operatingModeRaw = searchParams.get("operatingMode")?.trim() || "all";
  if (!OPERATING_MODES.has(operatingModeRaw as AdminAlliancesOperatingMode)) {
    return { ok: false, error: "Invalid operatingMode" };
  }

  const sortRaw = searchParams.get("sort")?.trim() || "name";
  if (!SORT_FIELDS.has(sortRaw as AdminAlliancesSort)) {
    return { ok: false, error: "Invalid sort" };
  }

  const orderRaw = searchParams.get("order")?.trim() || "asc";
  if (!ORDER_DIRS.has(orderRaw as AdminAlliancesOrder)) {
    return { ok: false, error: "Invalid order" };
  }

  const limitRaw = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  const offsetRaw = Number(searchParams.get("offset") ?? 0);
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

  return {
    ok: true,
    params: {
      q,
      operatingMode: operatingModeRaw as AdminAlliancesOperatingMode,
      sort: sortRaw as AdminAlliancesSort,
      order: orderRaw as AdminAlliancesOrder,
      limit,
      offset,
    },
  };
}

export function buildAdminAlliancesSearchParams(
  params: AdminAlliancesQueryParams,
): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.operatingMode !== "all") {
    search.set("operatingMode", params.operatingMode);
  }
  if (params.sort !== "name") {
    search.set("sort", params.sort);
  }
  if (params.order !== "asc") {
    search.set("order", params.order);
  }
  if (params.limit !== DEFAULT_LIMIT) {
    search.set("limit", String(params.limit));
  }
  if (params.offset > 0) {
    search.set("offset", String(params.offset));
  }
  return search.toString();
}
