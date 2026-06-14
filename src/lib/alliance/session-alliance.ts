import { eq } from "drizzle-orm";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";

/** Resolve alliance ID from the session tag and keep session row in sync. */
export async function resolveSessionAllianceId(
  sessionId: string,
  connection: ParsedConnection,
): Promise<string> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session?.allianceTag) {
    throw new Error(
      "Alliance tag not set. Add your in-game tag (e.g. LFgo) in Settings or reconnect.",
    );
  }

  const resolved = await resolveAllianceByTag(connection, session.allianceTag);

  if (
    session.allianceId !== resolved.id ||
    session.allianceTag !== resolved.tag
  ) {
    await db
      .update(schema.sessions)
      .set({
        allianceId: resolved.id,
        allianceTag: resolved.tag,
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  return resolved.id;
}

export async function getSessionAllianceTag(
  sessionId: string,
): Promise<string | null> {
  const db = getDb();
  const [session] = await db
    .select({ allianceTag: schema.sessions.allianceTag })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  return session?.allianceTag ?? null;
}
