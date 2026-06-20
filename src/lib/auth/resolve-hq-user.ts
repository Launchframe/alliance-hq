import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";

/** Auth.js JWT email flow may pass a UUID `user.id` that is not our `hq_users` row. */
export async function ensureHqUserForAuthEmail(
  email: string,
  displayName?: string | null,
): Promise<string> {
  const normalized = normalizeAshedEmail(email.trim());
  if (!normalized) {
    throw new Error("Email is required.");
  }

  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: schema.hqUsers.id, displayName: schema.hqUsers.displayName })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (existing) {
    await db
      .update(schema.hqUsers)
      .set({
        emailVerifiedAt: now,
        ...(displayName?.trim() && !existing.displayName
          ? { displayName: displayName.trim() }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, existing.id));

    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email: normalized,
    displayName: displayName?.trim() || null,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}
