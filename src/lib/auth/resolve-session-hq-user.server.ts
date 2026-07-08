import "server-only";

import { eq } from "drizzle-orm";
import type { Session } from "next-auth";

import { getDb, schema } from "@/lib/db";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";

/**
 * Canonical HQ user id for an Auth.js session. Prefer JWT `sub` so an email
 * change does not re-resolve to a different hq_users row via ensureHqUserForAuthEmail.
 */
export async function resolveSessionHqUserId(
  session: Session,
): Promise<string | null> {
  const sub = session.user?.id?.trim();
  if (sub) {
    const db = getDb();
    const [row] = await db
      .select({ id: schema.hqUsers.id })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, sub))
      .limit(1);
    if (row) {
      return row.id;
    }
  }

  const email = session.user?.email?.trim();
  if (!email) {
    return null;
  }

  return ensureHqUserForAuthEmail(email, session.user?.name);
}
