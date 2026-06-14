import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadSession } from "@/lib/session";

import { normalizeAccountTimezoneId } from "@/lib/timezone/account";
import {
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  type AccountTimezoneId,
} from "@/lib/timezone/constants";

export async function getAccountTimezoneIdForSession(
  sessionId: string,
): Promise<AccountTimezoneId> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return DEFAULT_ACCOUNT_TIMEZONE_ID;
  }

  const db = getDb();
  const [user] = await db
    .select({ timezone: schema.hqUsers.timezone })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, session.hqUserId))
    .limit(1);

  return normalizeAccountTimezoneId(user?.timezone);
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
