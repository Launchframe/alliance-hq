import "server-only";

import { and, eq } from "drizzle-orm";

import type { SessionAllianceOption } from "@/lib/alliance/types";
import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import type { AllianceOperatingMode } from "@/lib/native-alliance/constants";
import { parseOperatingMode } from "@/lib/native-alliance/operating-mode";

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

export async function loadLinkedCommanderAllianceIds(
  hqUserId: string,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .selectDistinct({
      allianceId: schema.commanderAllianceMemberships.allianceId,
    })
    .from(schema.hqUserCommanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(
        schema.commanderAllianceMemberships.commanderId,
        schema.hqUserCommanders.commanderId,
      ),
    )
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, hqUserId),
        eq(schema.commanderAllianceMemberships.status, "active"),
      ),
    );

  return new Set(rows.map((row) => row.allianceId));
}

async function listAllAllianceSummaries(): Promise<
  Array<{
    id: string;
    tag: string | null;
    name: string;
    slug: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
    })
    .from(schema.alliances);

  return rows.sort((a, b) => {
    const tagA = a.tag ?? a.slug;
    const tagB = b.tag ?? b.slug;
    return tagA.localeCompare(tagB);
  });
}

function attachLinkedCommanderFlags(
  options: SessionAllianceOption[],
  commanderAllianceIds: Set<string>,
): SessionAllianceOption[] {
  return options.map((option) => ({
    ...option,
    hasLinkedCommanders: commanderAllianceIds.has(option.id),
  }));
}

export async function listAlliancePickerOptions(
  hqUserId: string,
  isPlatformMaintainer: boolean,
): Promise<SessionAllianceOption[]> {
  const commanderAllianceIds = await loadLinkedCommanderAllianceIds(hqUserId);
  const memberships = await listSessionAlliances(hqUserId);

  if (!isPlatformMaintainer) {
    return attachLinkedCommanderFlags(memberships, commanderAllianceIds);
  }

  const membershipById = new Map(memberships.map((row) => [row.id, row]));
  const allAlliances = await listAllAllianceSummaries();

  return attachLinkedCommanderFlags(
    allAlliances.map((alliance) => {
      const membership = membershipById.get(alliance.id);
      return {
        id: alliance.id,
        tag: alliance.tag,
        name: alliance.name,
        slug: alliance.slug,
        roleName: membership?.roleName ?? "",
      };
    }),
    commanderAllianceIds,
  );
}

export async function loadAlliancePickerOptionById(
  allianceId: string,
  hqUserId: string,
  isPlatformMaintainer: boolean,
): Promise<SessionAllianceOption | null> {
  const options = await listAlliancePickerOptions(
    hqUserId,
    isPlatformMaintainer,
  );
  return options.find((row) => row.id === allianceId) ?? null;
}

export async function allianceExists(allianceId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return Boolean(row);
}

async function hqUserIsPlatformMaintainer(hqUserId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row?.isPlatformMaintainer === 1;
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
 * Switch session alliance context after verifying HQ membership, or platform
 * maintainer access to any registered alliance. Syncs allianceTag / allianceId
 * from the target alliance row.
 *
 * The session's personal Ashed credential is intentionally preserved across
 * switches: it represents the signed-in user's own Ashed identity (keyed by
 * session, bound to their hqUser via `ashedUserId`), not a per-alliance
 * connection. Dropping it on every switch made Ashed-powered features unusable
 * after switching — most visibly video OCR, where the approver's personal
 * credential is the OCR engine regardless of which alliance the job belongs to.
 * Shared-browser / wrong-user cases are still handled by the orphan-clear in
 * `getAshedConnection` (bound-user mismatch), which is independent of switching.
 */
export async function switchSessionCurrentAlliance(
  session: Session,
  allianceId: string,
): Promise<SwitchSessionAllianceResult> {
  if (!session.hqUserId) {
    throw new Error("HQ user required to switch alliance.");
  }

  const isPlatformMaintainer = await hqUserIsPlatformMaintainer(
    session.hqUserId,
  );
  const allowed =
    isPlatformMaintainer ||
    (await sessionHasMembershipForAlliance(session.hqUserId, allianceId));
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

  // Update only the alliance tenant context. The personal Ashed credential and
  // userLabel persist across switches (see doc comment above).
  await db
    .update(schema.sessions)
    .set({
      currentAllianceId: alliance.id,
      allianceTag: tag,
      allianceId: alliance.ashedAllianceId ?? null,
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

/** Session alliance id that matches one of the caller's roster memberships. */
export function findSessionAllianceMembership(
  session: Session,
  alliances: SessionAllianceOption[],
): SessionAllianceOption | null {
  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return null;
  }
  return alliances.find((row) => row.id === allianceId) ?? null;
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
