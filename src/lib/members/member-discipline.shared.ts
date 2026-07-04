export type MemberDisciplineRow = {
  id: string;
  commendationType?: string | null;
  violationType?: string | null;
  notes: string | null;
  recordedDate: string | null;
  expungedAt?: string | null;
};

export type ParsedAshedDisciplineRecord = {
  ashedId: string | null;
  type: string | null;
  notes: string | null;
  recordedDate: string | null;
  expungedAt: Date | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAshedId(record: Record<string, unknown>): string | null {
  return (
    readString(record.id) ??
    readString(record.ashed_id) ??
    readString(record.ashedId) ??
    null
  );
}

function readDisciplineType(
  record: Record<string, unknown>,
  kind: "commendation" | "violation",
): string | null {
  if (kind === "violation") {
    return (
      readString(record.violation_type) ??
      readString(record.violationType) ??
      readString(record.type) ??
      null
    );
  }
  return (
    readString(record.commendation_type) ??
    readString(record.commendationType) ??
    readString(record.type) ??
    null
  );
}

function readRecordedDate(record: Record<string, unknown>): string | null {
  return (
    readString(record.recorded_date) ??
    readString(record.recordedDate) ??
    readString(record.date) ??
    null
  );
}

function readExpungedAt(record: Record<string, unknown>): Date | null {
  const raw =
    readString(record.expunged_at) ??
    readString(record.expungedAt) ??
    readString(record.deleted_at);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseAshedDisciplineRecord(
  record: Record<string, unknown>,
  kind: "commendation" | "violation",
): ParsedAshedDisciplineRecord {
  return {
    ashedId: readAshedId(record),
    type: readDisciplineType(record, kind),
    notes: readString(record.notes),
    recordedDate: readRecordedDate(record),
    expungedAt: kind === "violation" ? readExpungedAt(record) : null,
  };
}
