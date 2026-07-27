import type { TimeOffActivityScope } from "@/lib/time-off/types.shared";

export type AshedExcusedRecordType = "vs" | "donation";

export type ParsedAshedExcusedRecord = {
  ashedId: string;
  recordType: AshedExcusedRecordType;
  /** Server calendar date (YYYY-MM-DD) — time-of-day, if any, is dropped. */
  startDate: string;
  endDate: string;
  reason: string | null;
  allianceId: string | null;
  memberId: string | null;
};

export type GroupedExcusedEntry = {
  activityScope: TimeOffActivityScope;
  startDate: string;
  endDate: string;
  reason: string | null;
  /** 1 id for vs/donation-only rows, 2 (vs + donation) for a merged "all" row. */
  ashedExcusedIds: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readId(value: unknown): string | null {
  if (typeof value === "string") return readString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Accepts plain "YYYY-MM-DD" or an ISO datetime and returns the date-only portion. */
function readDateOnly(value: unknown): string | null {
  const str = readString(value);
  if (!str) return null;
  const match = ISO_DATE.exec(str);
  return match ? match[0] : null;
}

function readRecordType(value: unknown): AshedExcusedRecordType | null {
  const str = readString(value)?.toLowerCase();
  return str === "vs" || str === "donation" ? str : null;
}

/**
 * Parses one raw Ashed `ExcusedRecord` row (from `GET /entities/ExcusedRecord`)
 * into a normalized shape. Returns null when required fields are missing or
 * unrecognized, so callers can safely drop malformed rows.
 */
export function parseAshedExcusedRecord(
  record: Record<string, unknown>,
): ParsedAshedExcusedRecord | null {
  const ashedId = readId(record.id);
  const recordType = readRecordType(record.record_type);
  const startDate = readDateOnly(record.start_date);
  const endDate = readDateOnly(record.end_date);
  if (!ashedId || !recordType || !startDate || !endDate) {
    return null;
  }
  return {
    ashedId,
    recordType,
    startDate,
    endDate,
    reason: readString(record.reason),
    allianceId: readId(record.alliance_id),
    memberId: readId(record.member_id),
  };
}

/** Maps an HQ activity scope to the Ashed `record_type`(s) POSTed for it. */
export function activityScopeToRecordTypes(
  scope: TimeOffActivityScope,
): AshedExcusedRecordType[] {
  if (scope === "vs") return ["vs"];
  if (scope === "donation") return ["donation"];
  return ["vs", "donation"];
}

function groupKey(record: ParsedAshedExcusedRecord): string {
  return `${record.startDate}|${record.endDate}|${record.reason ?? ""}`;
}

/**
 * Groups parsed `ExcusedRecord` rows into HQ `member_time_off` entries.
 *
 * A `vs` + `donation` pair sharing the same start/end/reason is Ashed's
 * "All Activities" shortcut (two POSTs, same dates+reason) — it collapses
 * into a single entry with `activityScope: "all"` and both ids. Anything
 * else (vs-only, donation-only, or duplicate/ambiguous rows sharing a key)
 * becomes one entry per record.
 */
export function groupParsedExcusedRecordsIntoEntries(
  records: ParsedAshedExcusedRecord[],
): GroupedExcusedEntry[] {
  const byKey = new Map<string, ParsedAshedExcusedRecord[]>();
  for (const record of records) {
    const key = groupKey(record);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      byKey.set(key, [record]);
    }
  }

  const entries: GroupedExcusedEntry[] = [];
  for (const bucket of byKey.values()) {
    const vsRecords = bucket.filter((record) => record.recordType === "vs");
    const donationRecords = bucket.filter(
      (record) => record.recordType === "donation",
    );

    if (vsRecords.length === 1 && donationRecords.length === 1) {
      const vs = vsRecords[0]!;
      const donation = donationRecords[0]!;
      entries.push({
        activityScope: "all",
        startDate: vs.startDate,
        endDate: vs.endDate,
        reason: vs.reason,
        ashedExcusedIds: [vs.ashedId, donation.ashedId],
      });
      continue;
    }

    for (const record of bucket) {
      entries.push({
        activityScope: record.recordType,
        startDate: record.startDate,
        endDate: record.endDate,
        reason: record.reason,
        ashedExcusedIds: [record.ashedId],
      });
    }
  }

  return entries;
}
