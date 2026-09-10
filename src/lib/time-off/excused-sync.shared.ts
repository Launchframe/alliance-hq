import { isTimeOffDate } from "./workflow.shared";

export type ExcusedRecordType = "vs" | "donation";
export type TimeOffActivityScope = ExcusedRecordType | "all";
export type TimeOffSyncStatus = "local" | "pending" | "synced" | "failed" | "cancel_pending" | "credentials_required" | "conflict" | "uncertain";
export type ExcusedRecord = {
  id: string;
  allianceId: string;
  memberId: string;
  recordType: ExcusedRecordType;
  startDate: string;
  endDate: string;
  reason: string | null;
  changedAt: string | null;
};
export type DesiredExcusedRecord = Omit<ExcusedRecord, "id" | "changedAt">;
export type SyncDecision = "done" | "create" | "replace" | "delete" | "conflict" | "uncertain";

export function ownsPrivateTimeOffNotes(entry: { privateNotesOwned?: boolean; createdByHqUserId?: string | null; createdByDiscordUserId?: string | null }) {
  return !!(entry.privateNotesOwned || entry.createdByHqUserId || entry.createdByDiscordUserId);
}

export class ExcusedSyncError extends Error {
  constructor(public readonly code: "invalid_snapshot" | "credentials_required" | "failed" | "uncertain" | "conflict" | "busy", public readonly httpStatus?: number) {
    super(code);
  }
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ExcusedSyncError("invalid_snapshot");
  return value.trim();
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string") throw new ExcusedSyncError("invalid_snapshot");
  if (value.length === 10) {
    if (!isTimeOffDate(value)) throw new ExcusedSyncError("invalid_snapshot");
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !Number.isFinite(Date.parse(value)) || !isTimeOffDate(value.slice(0, 10))) throw new ExcusedSyncError("invalid_snapshot");
  return value.slice(0, 10);
}

export function parseExcusedSnapshot(body: unknown, allianceId: string, now = new Date()): ExcusedRecord[] {
  if (!Array.isArray(body)) throw new ExcusedSyncError("invalid_snapshot");
  const ids = new Set<string>();
  return body.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExcusedSyncError("invalid_snapshot");
    const row = value as Record<string, unknown>;
    const id = identifier(row.id);
    const tenant = identifier(row.alliance_id);
    const memberId = identifier(row.member_id);
    if (tenant !== allianceId || ids.has(id)) throw new ExcusedSyncError("invalid_snapshot");
    ids.add(id);
    if (row.record_type !== "vs" && row.record_type !== "donation") throw new ExcusedSyncError("invalid_snapshot");
    const startDate = calendarDate(row.start_date);
    const endDate = calendarDate(row.end_date);
    if (!isTimeOffDate(startDate) || !isTimeOffDate(endDate) || endDate < startDate) throw new ExcusedSyncError("invalid_snapshot");
    if (row.reason != null && typeof row.reason !== "string") throw new ExcusedSyncError("invalid_snapshot");
    const timestamp = typeof row.updated_date === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.updated_date) ? Date.parse(row.updated_date) : NaN;
    const changedAt = Number.isFinite(timestamp) && timestamp <= now.getTime() ? new Date(timestamp).toISOString() : null;
    return { id, allianceId: tenant, memberId, recordType: row.record_type, startDate, endDate, reason: typeof row.reason === "string" ? row.reason : null, changedAt };
  });
}

export function desiredExcusedRecord(entry: {
  ashedMemberId: string;
  startDate: string;
  endDate: string;
  entryKind: string;
  activityScope?: string;
  cancelledAt: Date | string | null;
}, allianceId: string, recordType: ExcusedRecordType, reason: string): DesiredExcusedRecord | null {
  if (entry.cancelledAt || (entry.entryKind !== "planned" && entry.entryKind !== "officer_marked")) return null;
  if (entry.activityScope && entry.activityScope !== "all" && entry.activityScope !== recordType) return null;
  return { allianceId, memberId: entry.ashedMemberId, recordType, startDate: entry.startDate, endDate: entry.endDate, reason };
}

export function sameExcusedContent(a: DesiredExcusedRecord, b: DesiredExcusedRecord): boolean {
  return a.allianceId === b.allianceId && a.memberId === b.memberId && a.recordType === b.recordType && a.startDate === b.startDate && a.endDate === b.endDate && (a.reason ?? "") === (b.reason ?? "");
}

export function sameExcusedVersion(a: ExcusedRecord, b: ExcusedRecord): boolean {
  return a.id === b.id && sameExcusedContent(a, b) && a.changedAt === b.changedAt;
}

export function decideExcusedSync(input: {
  desired: DesiredExcusedRecord | null;
  remoteId: string | null;
  remote: ExcusedRecord | null;
  baseline: ExcusedRecord | null;
  uncertain: boolean;
  candidates: ExcusedRecord[];
}): SyncDecision {
  const { desired, remote, remoteId, baseline, uncertain, candidates } = input;
  if (!remoteId) {
    if (uncertain || desired && candidates.some((candidate) => sameExcusedContent(desired, candidate))) return "uncertain";
    return desired ? "create" : "done";
  }
  if (!remote) return desired ? "conflict" : "done";
  if (desired && sameExcusedContent(desired, remote)) return "done";
  if (!baseline || !sameExcusedVersion(baseline, remote)) return "conflict";
  return desired ? "replace" : "delete";
}

export function groupExcusedRecords(records: ExcusedRecord[]): Array<{ scope: TimeOffActivityScope; records: ExcusedRecord[] }> {
  const buckets = new Map<string, ExcusedRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.allianceId, record.memberId, record.startDate, record.endDate, record.reason ?? ""]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].flatMap<{ scope: TimeOffActivityScope; records: ExcusedRecord[] }>((bucket) => {
    if (bucket.length === 2 && bucket[0].recordType !== bucket[1].recordType) {
      return [{ scope: "all" as const, records: [...bucket].sort((a) => a.recordType === "vs" ? -1 : 1) }];
    }
    return bucket.map((record) => ({ scope: record.recordType, records: [record] }));
  });
}
