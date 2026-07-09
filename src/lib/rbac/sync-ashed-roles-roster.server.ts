import "server-only";

import { eq } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import {
  hqUserHasAccessGrant,
  isAshedInviteRequired,
} from "@/lib/access/invite-gate";
import { getDb, schema } from "@/lib/db";

/** Roster sync attaches ashed memberships only to existing HQ users — never creates email stubs. */
export async function resolveRosterHqUserId(
  email: string,
): Promise<string | null> {
  const normalized = normalizeAshedEmail(email);
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!existing) {
    return null;
  }

  if (
    isAshedInviteRequired() &&
    !(await hqUserHasAccessGrant(existing.id))
  ) {
    return null;
  }

  return existing.id;
}
