import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import { normalizeAccountTimezoneId } from "@/lib/timezone/account";
import {
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  type AccountTimezoneId,
} from "@/lib/timezone/constants";

export async function getAccountTimezoneIdForHqUser(
  hqUserId: string | null | undefined,
): Promise<AccountTimezoneId> {
  if (!hqUserId) {
    return DEFAULT_ACCOUNT_TIMEZONE_ID;
  }

  const db = getDb();
  const [user] = await db
    .select({ timezone: schema.hqUsers.timezone })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  return normalizeAccountTimezoneId(user?.timezone);
}

/** Resolve timezone for a session without importing @/lib/session (avoids circular deps). */
export async function getAccountTimezoneIdForSession(
  sessionId: string,
): Promise<AccountTimezoneId> {
  const db = getDb();
  const [session] = await db
    .select({ hqUserId: schema.sessions.hqUserId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  return getAccountTimezoneIdForHqUser(session?.hqUserId);
}

export async function updateAccountTimezone(
  hqUserId: string,
  timezoneId: AccountTimezoneId,
): Promise<void> {
  const db = getDb();
  const stored =
    timezoneId === DEFAULT_ACCOUNT_TIMEZONE_ID ? null : timezoneId.trim();

  await db
    .update(schema.hqUsers)
    .set({
      timezone: stored,
      updatedAt: new Date(),
    })
    .where(eq(schema.hqUsers.id, hqUserId));
}
