import {
  TIME_OFF_AVAILABILITIES,
  TIME_OFF_ENTRY_KINDS,
  TIME_OFF_SOURCES,
  type SerializedTimeOffEntry,
  type TimeOffAvailability,
  type TimeOffEntryKind,
  type TimeOffSource,
} from "@/lib/time-off/types.shared";

export type TimeOffEntryPayload = {
  ashedMemberId: string;
  memberName: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
  availability?: TimeOffAvailability;
  entryKind?: TimeOffEntryKind;
  source?: TimeOffSource;
};

export function isTimeOffAvailability(
  value: string,
): value is TimeOffAvailability {
  return (TIME_OFF_AVAILABILITIES as readonly string[]).includes(value);
}

export function isTimeOffEntryKind(value: string): value is TimeOffEntryKind {
  return (TIME_OFF_ENTRY_KINDS as readonly string[]).includes(value);
}

export function isTimeOffSource(value: string): value is TimeOffSource {
  return (TIME_OFF_SOURCES as readonly string[]).includes(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTimeOffEntryPayload(
  body: TimeOffEntryPayload,
): string | null {
  if (!body.ashedMemberId?.trim()) {
    return "ashedMemberId is required.";
  }
  if (!body.memberName?.trim()) {
    return "memberName is required.";
  }
  if (!ISO_DATE.test(body.startDate)) {
    return "startDate must be YYYY-MM-DD.";
  }
  if (!ISO_DATE.test(body.endDate)) {
    return "endDate must be YYYY-MM-DD.";
  }
  if (body.endDate < body.startDate) {
    return "endDate must be on or after startDate.";
  }
  if (body.availability && !isTimeOffAvailability(body.availability)) {
    return "Invalid availability.";
  }
  if (body.entryKind && !isTimeOffEntryKind(body.entryKind)) {
    return "Invalid entry kind.";
  }
  if (body.source && !isTimeOffSource(body.source)) {
    return "Invalid source.";
  }
  return null;
}

export function serializeTimeOffEntry(row: {
  id: string;
  ashedMemberId: string;
  memberName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  availability: string;
  entryKind: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): SerializedTimeOffEntry {
  return {
    id: row.id,
    ashedMemberId: row.ashedMemberId,
    memberName: row.memberName,
    startDate: row.startDate,
    endDate: row.endDate,
    notes: row.notes,
    availability: isTimeOffAvailability(row.availability)
      ? row.availability
      : "full_away",
    entryKind: isTimeOffEntryKind(row.entryKind) ? row.entryKind : "planned",
    source: isTimeOffSource(row.source) ? row.source : "web",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function groupEntriesByDate(
  entries: SerializedTimeOffEntry[],
): Map<string, SerializedTimeOffEntry[]> {
  const map = new Map<string, SerializedTimeOffEntry[]>();
  for (const entry of entries) {
    let cursor = entry.startDate;
    while (cursor <= entry.endDate) {
      const bucket = map.get(cursor) ?? [];
      bucket.push(entry);
      map.set(cursor, bucket);
      const [y, m, d] = cursor.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1, 12));
      cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return map;
}
