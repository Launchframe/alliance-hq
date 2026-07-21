import "server-only";

import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

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

/** HQ alliance id plus legacy `video_jobs.alliance_id` Ashed stamp when present. */
export async function listStoredAllianceIdsForHqAlliance(
  hqAllianceId: string,
): Promise<string[]> {
  const id = hqAllianceId.trim();
  if (!id) return [];

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, id))
    .limit(1);

  if (!alliance) return [id];

  const ids = new Set<string>([alliance.id]);
  const ashed = alliance.ashedAllianceId?.trim();
  if (ashed) ids.add(ashed);
  return [...ids];
}

export function videoJobStoredAllianceIdIn(storedIds: readonly string[]) {
  if (storedIds.length === 0) return undefined;
  if (storedIds.length === 1) {
    return eq(schema.videoJobs.allianceId, storedIds[0]!);
  }
  return inArray(schema.videoJobs.allianceId, [...storedIds]);
}

export function videoUploadGroupStoredAllianceIdIn(storedIds: readonly string[]) {
  if (storedIds.length === 0) return undefined;
  if (storedIds.length === 1) {
    return eq(schema.videoUploadGroups.allianceId, storedIds[0]!);
  }
  return inArray(schema.videoUploadGroups.allianceId, [...storedIds]);
}
