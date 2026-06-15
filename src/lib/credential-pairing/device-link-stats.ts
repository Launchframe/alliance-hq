import { isNull, sql } from "drizzle-orm";

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
