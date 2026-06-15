import { inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type AdminReporterSummary = {
  id: string;
  email: string;
  displayName: string | null;
};

export async function loadReporterSummariesByIds(
  userIds: string[],
): Promise<Map<string, AdminReporterSummary>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
    })
    .from(schema.hqUsers)
    .where(inArray(schema.hqUsers.id, uniqueIds));

  return new Map(rows.map((row) => [row.id, row]));
}

export function reporterLabel(
  reporter: AdminReporterSummary | undefined,
  fallbackId: string | null | undefined,
): string {
  if (reporter) {
    return reporter.displayName?.trim()
      ? `${reporter.displayName} (${reporter.email})`
      : reporter.email;
  }
  return fallbackId ?? "—";
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
