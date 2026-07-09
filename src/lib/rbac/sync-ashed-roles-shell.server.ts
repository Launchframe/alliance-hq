import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import {
  allianceTagsMatchForShellAdoption,
  isUnlinkedHqAllianceShell,
  normalizeAllianceTagForMatch,
} from "@/lib/rbac/sync-ashed-roles.helpers";
import { getDb, schema } from "@/lib/db";

type HqAllianceRow = typeof schema.alliances.$inferSelect;

async function hqUserHasActiveMembershipOnAlliance(
  hqUserId: string,
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [membership] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(membership);
}

/** Adopt an existing native HQ alliance shell before creating a duplicate Ashed row. */
export async function findAdoptableHqAllianceShell(input: {
  ashedTag: string;
  preferHqAllianceId?: string | null;
  authHqUserId?: string | null;
}): Promise<HqAllianceRow | null> {
  const db = getDb();
  const preferId = input.preferHqAllianceId?.trim();

  if (preferId) {
    const [preferred] = await db
      .select()
      .from(schema.alliances)
      .where(eq(schema.alliances.id, preferId))
      .limit(1);

    if (
      preferred &&
      isUnlinkedHqAllianceShell(preferred) &&
      allianceTagsMatchForShellAdoption(preferred.tag, input.ashedTag) &&
      (!input.authHqUserId ||
        (await hqUserHasActiveMembershipOnAlliance(
          input.authHqUserId,
          preferred.id,
        )))
    ) {
      return preferred;
    }
  }

  const tagLower = normalizeAllianceTagForMatch(input.ashedTag);
  if (!tagLower) {
    return null;
  }

  const candidates = await db
    .select()
    .from(schema.alliances)
    .where(
      and(
        isNull(schema.alliances.ashedAllianceId),
        sql`lower(trim(${schema.alliances.tag})) = ${tagLower}`,
      ),
    );

  if (candidates.length !== 1) {
    return null;
  }

  const [candidate] = candidates;
  if (
    input.authHqUserId &&
    !(await hqUserHasActiveMembershipOnAlliance(
      input.authHqUserId,
      candidate.id,
    ))
  ) {
    return null;
  }

  return candidate;
}
