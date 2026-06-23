const LIKE_ESCAPE = "\\";

/** Escape `%`, `_`, and `\` so prefix filters cannot broaden SQL LIKE matches. */
export function escapeLikePrefix(value: string): string {
  return value
    .replace(/\\/g, `${LIKE_ESCAPE}\\`)
    .replace(/%/g, `${LIKE_ESCAPE}%`)
    .replace(/_/g, `${LIKE_ESCAPE}_`);
}

export const AUDIT_ACTION_FILTER_OPTIONS = [
  { value: "", labelKey: "allActions" as const },
  { value: "bff.entity.*", labelKey: "bffEntity" as const },
  { value: "bff.integration", labelKey: "bffIntegration" as const },
  { value: "bff.function.call", labelKey: "bffFunction" as const },
  { value: "video.*", labelKey: "video" as const },
  { value: "feedback.*", labelKey: "feedback" as const },
  { value: "invite.*", labelKey: "invite" as const },
  { value: "member_link.*", labelKey: "memberLink" as const },
] as const;

export type AuditLogFilters = {
  allianceId?: string;
  /** Resolved server-side: HQ row id + Ashed alliance id for audit_log matching */
  allianceMatchIds?: string[];
  action?: string;
  since?: Date;
  until?: Date;
  hqUserId?: string;
  limit: number;
};

export type ParseAuditLogQueryResult =
  | { ok: true; filters: AuditLogFilters }
  | { ok: false; error: string };

function parseOptionalIsoDate(
  raw: string | null,
  field: string,
): { ok: true; date?: Date } | { ok: false; error: string } {
  if (!raw?.trim()) {
    return { ok: true };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `Invalid ${field} date` };
  }
  return { ok: true, date: parsed };
}

export function normalizeAuditActionFilter(action: string): {
  kind: "exact" | "prefix";
  value: string;
} {
  const trimmed = action.trim();
  if (trimmed.endsWith(".*")) {
    return { kind: "prefix", value: trimmed.slice(0, -2) };
  }
  if (trimmed.endsWith("*")) {
    return { kind: "prefix", value: trimmed.slice(0, -1) };
  }
  return { kind: "exact", value: trimmed };
}

export function parseAuditLogQueryParams(
  searchParams: URLSearchParams,
): ParseAuditLogQueryResult {
  const allianceId = searchParams.get("allianceId")?.trim() || undefined;
  const action = searchParams.get("action")?.trim() || undefined;
  const hqUserId = searchParams.get("hqUserId")?.trim() || undefined;

  const sinceResult = parseOptionalIsoDate(searchParams.get("since"), "since");
  if (!sinceResult.ok) {
    return { ok: false, error: sinceResult.error };
  }

  const untilResult = parseOptionalIsoDate(searchParams.get("until"), "until");
  if (!untilResult.ok) {
    return { ok: false, error: untilResult.error };
  }

  if (
    sinceResult.date &&
    untilResult.date &&
    sinceResult.date > untilResult.date
  ) {
    return { ok: false, error: "since must be before until" };
  }

  const limitRaw = Number(searchParams.get("limit") ?? 100);
  const limit = Math.min(
    Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100,
    500,
  );

  if (action) {
    const normalized = normalizeAuditActionFilter(action);
    if (normalized.kind === "prefix" && normalized.value.length === 0) {
      return { ok: false, error: "Invalid action filter" };
    }
  }

  return {
    ok: true,
    filters: {
      allianceId,
      action,
      since: sinceResult.date,
      until: untilResult.date,
      hqUserId,
      limit,
    },
  };
}

export function buildAuditLogSearchParams(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.allianceId) params.set("allianceId", filters.allianceId);
  if (filters.action) params.set("action", filters.action);
  if (filters.hqUserId) params.set("hqUserId", filters.hqUserId);
  if (filters.since) params.set("since", filters.since.toISOString());
  if (filters.until) params.set("until", filters.until.toISOString());
  params.set("limit", String(filters.limit));
  return params.toString();
}
