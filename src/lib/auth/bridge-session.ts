import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  getOrCreateSession,
  resolveBrowserSessionHqUserId,
} from "@/lib/session";

export async function bridgeAuthUserToBrowserSession(input: {
  hqUserId: string;
  email: string;
  displayName?: string | null;
  markEmailVerified?: boolean;
}): Promise<string> {
  const session = await getOrCreateSession();
  const db = getDb();
  const now = new Date();
  const hqUserId = await resolveBrowserSessionHqUserId(input.hqUserId);
  const userLabel =
    input.displayName?.trim() || input.email.trim() || session.userLabel;

  if (input.markEmailVerified !== false) {
    await db
      .update(schema.hqUsers)
      .set({
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, hqUserId));
  }

  await db
    .update(schema.sessions)
    .set({
      hqUserId,
      userLabel: userLabel ?? null,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, session.id));

  return session.id;
}
