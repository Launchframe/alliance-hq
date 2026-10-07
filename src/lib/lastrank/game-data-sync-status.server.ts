import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  resolveGameDataSyncStatus,
  type GameDataSyncStatus,
} from "@/lib/lastrank/sync-registry.shared";

export async function loadGameDataSyncStatus(allianceId: string): Promise<GameDataSyncStatus> {
  const [row] = await getDb()
    .select({
      tag: schema.alliances.tag,
      gameServerNumber: schema.alliances.gameServerNumber,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  if (!row) return { linked: false };
  return resolveGameDataSyncStatus(row.gameServerNumber, row.tag);
}
