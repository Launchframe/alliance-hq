import { canCancelTimeOffEntry, isTimeOffEntryKind } from "./api.shared";
import type { TimeOffEntryKind } from "./types.shared";

export const TIME_OFF_MAX_DAYS = 366;
export const TIME_OFF_MAX_NOTES = 1000;

export type TimeOffErrorCode =
  | "invalidDate" | "invalidRange" | "rangeTooLong" | "notesTooLong"
  | "parseFailed" | "commanderRequired" | "commanderUnavailable"
  | "entryUnavailable" | "forbidden" | "officerOnly" | "staleEntry"
  | "expired" | "loadFailed" | "saveFailed" | "cancelFailed";

export class TimeOffError extends Error {
  constructor(public readonly code: TimeOffErrorCode, public readonly status = 400) {
    super(code);
  }
}

export type TimeOffDraft = {
  ashedMemberId: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  entryKind: TimeOffEntryKind;
};

export type TimeOffViewer = {
  canManageOthers: boolean;
  ownedCommanderIds: readonly string[];
};

export type TimeOffRevisionSnapshot = {
  startDate: string;
  endDate: string;
  entryKind: TimeOffEntryKind;
  globalAbsence: boolean;
  cancelled: boolean;
  activityScope?: "vs" | "donation" | "all";
};

export function isTimeOffDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function parseTimeOffDraft(body: unknown): TimeOffDraft {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TimeOffError("commanderRequired");
  const input = body as Record<string, unknown>;
  if (typeof input.ashedMemberId !== "string" || !input.ashedMemberId.trim()) throw new TimeOffError("commanderRequired");
  if (!isTimeOffDate(input.startDate) || !isTimeOffDate(input.endDate)) throw new TimeOffError("invalidDate");
  if (input.endDate < input.startDate) throw new TimeOffError("invalidRange");
  if ((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 >= TIME_OFF_MAX_DAYS) throw new TimeOffError("rangeTooLong");
  if (input.notes != null && typeof input.notes !== "string") throw new TimeOffError("notesTooLong");
  const notes = typeof input.notes === "string" ? input.notes.trim() : null;
  if (notes && notes.length > TIME_OFF_MAX_NOTES) throw new TimeOffError("notesTooLong");
  const kind = input.entryKind ?? "planned";
  if (typeof kind !== "string" || !isTimeOffEntryKind(kind)) throw new TimeOffError("forbidden");
  return {
    ashedMemberId: input.ashedMemberId.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    notes: notes || null,
    entryKind: kind,
  };
}

export function canManageTimeOffEntry(input: {
  entryKind: string;
  canManageOthers: boolean;
  ownsCommander: boolean;
}): boolean {
  return isTimeOffEntryKind(input.entryKind) && canCancelTimeOffEntry({ ...input, entryKind: input.entryKind });
}

export function timeOffEntryForViewer<T extends { ashedMemberId: string; notes: string | null }>(entry: T, viewer: TimeOffViewer): T {
  return {
    ...entry,
    notes: viewer.canManageOthers || viewer.ownedCommanderIds.includes(entry.ashedMemberId) ? entry.notes : null,
  };
}

export function timeOffExcusesDate(revisions: ReadonlyArray<{
  recordedAt: string;
  snapshot: TimeOffRevisionSnapshot;
}>, date: string, activity: "vs" | "donation" | "all" = "all"): boolean {
  if (!isTimeOffDate(date)) return false;
  const cutoff = Date.parse(`${date}T02:00:00.000Z`);
  let latest: (typeof revisions)[number] | undefined;
  for (const revision of revisions) {
    const timestamp = Date.parse(revision.recordedAt);
    if (timestamp < cutoff && (!latest || timestamp >= Date.parse(latest.recordedAt))) latest = revision;
  }
  const snapshot = latest?.snapshot;
  return !!snapshot && (snapshot.globalAbsence || snapshot.activityScope === activity || snapshot.activityScope === "all") && !snapshot.cancelled &&
    (snapshot.entryKind === "planned" || snapshot.entryKind === "officer_marked") &&
    snapshot.startDate <= date && date <= snapshot.endDate;
}
