import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";

/** True when the HQ user has an active membership but no commander link for that alliance. */
export async function hqUserNeedsCommanderLink(hqUserId: string): Promise<boolean> {
  const trimmed = hqUserId.trim();
  if (!trimmed) {
    return false;
  }

  const db = getDb();
  const memberships = await db
    .select({ allianceId: schema.allianceMemberships.allianceId })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, trimmed),
        eq(schema.allianceMemberships.status, "active"),
      ),
    );

  for (const membership of memberships) {
    const link = await getHqMemberLinkForUser(membership.allianceId, trimmed);
    if (!link) {
      return true;
    }
  }

  return false;
}
