import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export async function bridgeAuthUserToBrowserSession(input: {
  hqUserId: string;
  email: string;
  displayName?: string | null;
  markEmailVerified?: boolean;
}): Promise<string> {
  const session = await getOrCreateSession();
  const db = getDb();
  const now = new Date();
  const userLabel =
    input.displayName?.trim() || input.email.trim() || session.userLabel;

  if (input.markEmailVerified !== false) {
    await db
      .update(schema.hqUsers)
      .set({
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, input.hqUserId));
  }

  await db
    .update(schema.sessions)
    .set({
      hqUserId: input.hqUserId,
      userLabel: userLabel ?? null,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, session.id));

  return session.id;
}
