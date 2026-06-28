import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * True when the HQ user has at least one active membership that lacks a
 * commander link. Uses a single batch query instead of N sequential fetches.
 */
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

  if (memberships.length === 0) {
    return false;
  }

  const allianceIds = memberships.map((m) => m.allianceId);

  const links = await db
    .select({ allianceId: schema.hqMemberLinks.allianceId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.hqUserId, trimmed),
        inArray(schema.hqMemberLinks.allianceId, allianceIds),
      ),
    );

  const linkedSet = new Set(links.map((l) => l.allianceId));
  return allianceIds.some((id) => !linkedSet.has(id));
}
