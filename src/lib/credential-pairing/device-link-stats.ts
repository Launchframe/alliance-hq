import { isNull, sql, and, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Active linked mobile devices per HQ user (non-revoked). */
export async function countCompletedDeviceLinksByHqUser(): Promise<
  Map<string, number>
> {
  const db = getDb();
  const rows = await db
    .select({
      hqUserId: schema.linkedDevices.hqUserId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.linkedDevices)
    .where(isNull(schema.linkedDevices.revokedAt))
    .groupBy(schema.linkedDevices.hqUserId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.hqUserId, row.count);
  }
  return counts;
}

/** Device link counts for a page of HQ users (avoids loading all users). */
export async function countCompletedDeviceLinksForUsers(
  hqUserIds: string[],
): Promise<Map<string, number>> {
  if (hqUserIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const rows = await db
    .select({
      hqUserId: schema.linkedDevices.hqUserId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.linkedDevices)
    .where(
      and(
        isNull(schema.linkedDevices.revokedAt),
        inArray(schema.linkedDevices.hqUserId, hqUserIds),
      ),
    )
    .groupBy(schema.linkedDevices.hqUserId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.hqUserId, row.count);
  }
  return counts;
}
