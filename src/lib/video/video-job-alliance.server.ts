import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export { isVideoJobAllianceStale } from "@/lib/video/video-job-alliance.shared";

/**
 * Normalize a video-job / parse-session `alliance_id` to the HQ tenant id.
 * Accepts either the HQ primary key or a legacy/mis-stamped Ashed alliance id.
 */
export async function resolveHqAllianceIdFromStoredAllianceId(
  storedAllianceId: string | null | undefined,
): Promise<string | null> {
  const id = storedAllianceId?.trim();
  if (!id) return null;

  const db = getDb();
  const [byPk] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, id))
    .limit(1);
  if (byPk) return byPk.id;

  const [byAshed] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.ashedAllianceId, id))
    .limit(1);
  return byAshed?.id ?? null;
}
