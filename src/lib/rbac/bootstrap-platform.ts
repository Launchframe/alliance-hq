import { eq, sql } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";

import { setPlatformMaintainer } from "./admin-users";

/** Promote the bootstrap email when no platform maintainer exists yet (one-time). */
export async function maybeBootstrapPlatformMaintainer(
  hqUserId: string,
  email: string,
): Promise<boolean> {
  const bootstrapEmail = process.env.PLATFORM_BOOTSTRAP_EMAIL?.trim();
  if (!bootstrapEmail) {
    return false;
  }

  if (normalizeAshedEmail(email) !== normalizeAshedEmail(bootstrapEmail)) {
    return false;
  }

  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.isPlatformMaintainer, 1));

  if ((row?.count ?? 0) > 0) {
    return false;
  }

  await setPlatformMaintainer(hqUserId, true);
  return true;
}
