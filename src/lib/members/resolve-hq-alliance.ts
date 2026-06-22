import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Resolve HQ tenant alliance id from session (not Ashed hex id). */
export async function resolveHqAllianceIdFromSession(
  sessionId: string,
): Promise<string> {
  const db = getDb();
  const [session] = await db
    .select({
      currentAllianceId: schema.sessions.currentAllianceId,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const hqAllianceId = session?.currentAllianceId?.trim();
  if (!hqAllianceId) {
    throw new Error(
      "No HQ alliance selected. Choose an alliance before uploading roster video.",
    );
  }

  return hqAllianceId;
}
