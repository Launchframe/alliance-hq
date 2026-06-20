import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import type { SessionAllianceOption } from "@/lib/alliance/types";

export type { SessionAllianceOption };

export async function listSessionAlliances(
  hqUserId: string,
): Promise<SessionAllianceOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
      roleName: schema.roles.name,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.allianceMemberships.allianceId),
    )
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    );

  return rows.sort((a, b) => {
    const tagA = a.tag ?? a.slug;
    const tagB = b.tag ?? b.slug;
    return tagA.localeCompare(tagB);
  });
}

export async function sessionHasMembershipForAlliance(
  hqUserId: string,
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
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

  return Boolean(row);
}

/**
 * Switch session alliance context after verifying HQ membership.
 * Syncs legacy session.allianceTag / allianceId from the alliance row when present.
 */
export async function switchSessionCurrentAlliance(
  session: Session,
  allianceId: string,
): Promise<{ allianceId: string; tag: string | null; name: string }> {
  if (!session.hqUserId) {
    throw new Error("HQ user required to switch alliance.");
  }

  const allowed = await sessionHasMembershipForAlliance(
    session.hqUserId,
    allianceId,
  );
  if (!allowed) {
    throw new Error("You do not have access to that alliance.");
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }

  const tag = alliance.tag?.trim() || null;

  await db
    .update(schema.sessions)
    .set({
      currentAllianceId: alliance.id,
      allianceTag: tag,
      allianceId: alliance.ashedAllianceId ?? session.allianceId,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, session.id));

  return {
    allianceId: alliance.id,
    tag,
    name: alliance.name,
  };
}

export function resolveSessionAllianceId(session: Session): string | null {
  return session.currentAllianceId ?? session.allianceId;
}
