import "server-only";

import { and, eq } from "drizzle-orm";

import type { SessionAllianceOption } from "@/lib/alliance/types";
import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import {
  parseOperatingMode,
} from "@/lib/native-alliance/operating-mode";
import type { AllianceOperatingMode } from "@/lib/native-alliance/constants";

export type SwitchSessionAllianceResult = {
  allianceId: string;
  tag: string | null;
  name: string;
  operatingMode: AllianceOperatingMode;
  redirectPath: string;
};

export function allianceLandingPath(
  operatingMode: AllianceOperatingMode,
): string {
  return operatingMode === "native" ? "/members" : "/dashboard";
}

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
 * Clears personal Ashed credentials and legacy session fields from the prior alliance,
 * then syncs allianceTag / allianceId from the target alliance row.
 */
export async function switchSessionCurrentAlliance(
  session: Session,
  allianceId: string,
): Promise<SwitchSessionAllianceResult> {
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
      operatingMode: schema.alliances.operatingMode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }

  const tag = alliance.tag?.trim() || null;
  const operatingMode = parseOperatingMode(alliance.operatingMode);

  // Drop personal Ashed JWT and legacy alliance fields from the prior context.
  await db
    .delete(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, session.id));

  await db
    .update(schema.sessions)
    .set({
      currentAllianceId: alliance.id,
      allianceTag: tag,
      allianceId: alliance.ashedAllianceId ?? null,
      userLabel: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, session.id));

  return {
    allianceId: alliance.id,
    tag,
    name: alliance.name,
    operatingMode,
    redirectPath: allianceLandingPath(operatingMode),
  };
}

export function resolveSessionAllianceId(session: Session): string | null {
  return session.currentAllianceId ?? session.allianceId;
}

/** When session lacks currentAllianceId, pick a sole membership or a resolved HQ id match. */
export function pickAllianceMembershipForSession(
  session: Session,
  alliances: SessionAllianceOption[],
): SessionAllianceOption | null {
  if (alliances.length === 0) {
    return null;
  }

  if (
    session.currentAllianceId &&
    alliances.some((row) => row.id === session.currentAllianceId)
  ) {
    return null;
  }

  const resolved = resolveSessionAllianceId(session);
  if (resolved) {
    const match = alliances.find((row) => row.id === resolved);
    if (match) {
      return match;
    }
  }

  if (alliances.length === 1) {
    return alliances[0]!;
  }

  return null;
}
