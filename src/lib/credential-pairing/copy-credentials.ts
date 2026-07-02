import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getAshedCredentialRecord } from "@/lib/session";

export async function copyEncryptedCredentialsToSession(
  sourceSessionId: string,
  targetSessionId: string,
): Promise<void> {
  const source = await getAshedCredentialRecord(sourceSessionId);
  if (!source) {
    throw new Error("Source session has no Ashed credentials.");
  }

  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, targetSessionId))
    .limit(1);

  if (existing) {
    await db
      .update(schema.ashedCredentials)
      .set({
        ashedUserId: source.ashedUserId,
        appId: source.appId,
        originUrl: source.originUrl,
        encryptedToken: source.encryptedToken,
        tokenExpiresAt: source.tokenExpiresAt,
        expiryReminderDays: source.expiryReminderDays,
        updatedAt: now,
      })
      .where(eq(schema.ashedCredentials.id, existing.id));
    return;
  }

  await db.insert(schema.ashedCredentials).values({
    id: nanoid(24),
    sessionId: targetSessionId,
    ashedUserId: source.ashedUserId,
    appId: source.appId,
    originUrl: source.originUrl,
    encryptedToken: source.encryptedToken,
    tokenExpiresAt: source.tokenExpiresAt,
    expiryReminderDays: source.expiryReminderDays,
    createdAt: now,
    updatedAt: now,
  });
}
