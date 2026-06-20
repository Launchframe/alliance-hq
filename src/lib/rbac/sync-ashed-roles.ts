import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  resolveSystemRoleForAlliance,
  userAllianceAccessRole,
  normalizeAshedEmail,
} from "@/lib/alliance/accessible";
import {
  hqUserHasAccessGrant,
  isAshedInviteRequired,
} from "@/lib/access/invite-gate";
import {
  buildAllianceRosterEmails,
  shouldRevokeAshedMembership,
} from "@/lib/rbac/sync-ashed-roles.helpers";
import type { AshedAllianceRow, AshedUserRef } from "@/lib/alliance/types";
import { parseAshedGameServerNumber } from "@/lib/game-season/ashed";
import { applySeasonSync } from "@/lib/game-season/sync";
import { base44ListAlliances } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";

import { ROLE_IDS, type SystemRoleName } from "./constants";
import { resolveAshedConnectRole } from "./resolve-ashed-connect-role";
import { resolveCanonicalHqUserForAshedConnect } from "./resolve-canonical-hq-user";

export type AshedUserInfo = AshedUserRef & {
  full_name?: string;
};

function slugFromTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function fetchAllianceByTag(
  connection: ParsedConnection,
  allianceTag: string,
): Promise<AshedAllianceRow | null> {
  const rows = await base44ListAlliances(connection);
  const tagLower = allianceTag.trim().toLowerCase();
  return (
    rows.find((row) => row.tag?.trim().toLowerCase() === tagLower) ?? null
  );
}

export async function upsertHqUser(user: AshedUserInfo): Promise<string> {
  const result = await resolveCanonicalHqUserForAshedConnect({
    ashedUserId: user.id,
    ashedEmail: user.email,
    displayName: user.full_name,
  });
  return result.hqUserId;
}

async function upsertHqUserStub(email: string) {
  const result = await resolveCanonicalHqUserForAshedConnect({
    ashedEmail: email,
  });
  return result.hqUserId;
}

async function resolveRosterHqUserId(email: string): Promise<string | null> {
  const normalized = normalizeAshedEmail(email);
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!existing) {
    if (isAshedInviteRequired()) {
      return null;
    }
    return upsertHqUserStub(email);
  }

  if (
    isAshedInviteRequired() &&
    !(await hqUserHasAccessGrant(existing.id))
  ) {
    return null;
  }

  return existing.id;
}

async function allianceHasOwner(allianceId: string): Promise<boolean> {
  const db = getDb();
  const [alliance] = await db
    .select({ ownerHqUserId: schema.alliances.ownerHqUserId })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (alliance?.ownerHqUserId) {
    return true;
  }

  const [ownerMembership] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.roles.name, "owner"),
      ),
    )
    .limit(1);

  return Boolean(ownerMembership);
}

async function upsertAllianceFromAshed(
  ashedAlliance: AshedAllianceRow,
  allianceTag: string,
): Promise<{ allianceId: string; wasCreated: boolean }> {
  const db = getDb();
  const now = new Date();
  const slug = slugFromTag(allianceTag);
  const tag = ashedAlliance.tag?.trim() || allianceTag.trim();
  const collaborators = (ashedAlliance.collaborators ?? []).map(normalizeAshedEmail);
  const gameServerNumber = parseAshedGameServerNumber(ashedAlliance);

  const [existing] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.ashedAllianceId, ashedAlliance.id ?? ""))
    .limit(1);

  if (existing) {
    await db
      .update(schema.alliances)
      .set({
        slug,
        tag,
        name: ashedAlliance.name ?? existing.name,
        ownerAshedUserId: ashedAlliance.owner_id ?? null,
        ownerEmail: ashedAlliance.owner_email
          ? normalizeAshedEmail(ashedAlliance.owner_email)
          : null,
        collaboratorsJson: collaborators,
        rolesSyncedAt: now,
        ...(gameServerNumber != null ? { gameServerNumber } : {}),
        updatedAt: now,
      })
      .where(eq(schema.alliances.id, existing.id));
    if (gameServerNumber != null) {
      try {
        await applySeasonSync(existing.id);
      } catch (error) {
        console.warn("[sync-ashed] season sync failed", existing.id, error);
      }
    }
    return { allianceId: existing.id, wasCreated: false };
  }

  const id = nanoid(16);
  await db.insert(schema.alliances).values({
    id,
    slug,
    tag,
    name: ashedAlliance.name ?? allianceTag,
    ashedAllianceId: ashedAlliance.id ?? null,
    ownerAshedUserId: ashedAlliance.owner_id ?? null,
    ownerEmail: ashedAlliance.owner_email
      ? normalizeAshedEmail(ashedAlliance.owner_email)
      : null,
    collaboratorsJson: collaborators,
    rolesSyncedAt: now,
    gameServerNumber: gameServerNumber ?? undefined,
    createdAt: now,
    updatedAt: now,
  });
  if (gameServerNumber != null) {
    try {
      await applySeasonSync(id);
    } catch (error) {
      console.warn("[sync-ashed] season sync failed", id, error);
    }
  }
  return { allianceId: id, wasCreated: true };
}

async function upsertAshedMembership(
  allianceId: string,
  hqUserId: string,
  roleName: SystemRoleName,
) {
  const db = getDb();
  const roleId = ROLE_IDS[roleName];
  const now = new Date();

  const [existing] = await db
    .select()
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, hqUserId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.source === "manual") {
      return;
    }
    await db
      .update(schema.allianceMemberships)
      .set({ roleId, status: "active", updatedAt: now })
      .where(eq(schema.allianceMemberships.id, existing.id));
    return;
  }

  await db.insert(schema.allianceMemberships).values({
    id: nanoid(16),
    allianceId,
    hqUserId,
    roleId,
    source: "ashed",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function revokeStaleAshedMemberships(
  allianceId: string,
  rosterEmails: Set<string>,
) {
  const db = getDb();
  const now = new Date();

  const members = await db
    .select({
      membershipId: schema.allianceMemberships.id,
      email: schema.hqUsers.email,
      source: schema.allianceMemberships.source,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.allianceMemberships.source, "ashed"),
      ),
    );

  for (const member of members) {
    if (
      shouldRevokeAshedMembership(member.email, rosterEmails, member.source)
    ) {
      await db
        .update(schema.allianceMemberships)
        .set({ status: "revoked", updatedAt: now })
        .where(eq(schema.allianceMemberships.id, member.membershipId));
    }
  }
}

export type SyncAshedAllianceRolesResult = {
  hqUserId: string;
  hqAllianceId: string;
  roleName: SystemRoleName;
  mergedFromHqUserId?: string;
};

async function syncAshedAllianceRolesCore(options: {
  connection: ParsedConnection;
  sessionId?: string;
  allianceTag: string;
  currentUser: AshedUserInfo;
  authHqUserId?: string | null;
}): Promise<SyncAshedAllianceRolesResult> {
  const { connection, sessionId, allianceTag, currentUser, authHqUserId } =
    options;
  const ashedAlliance = await fetchAllianceByTag(connection, allianceTag);
  if (!ashedAlliance?.id) {
    throw new Error(`Alliance "${allianceTag}" not found in Ashed.`);
  }

  const { allianceId: hqAllianceId, wasCreated } = await upsertAllianceFromAshed(
    ashedAlliance,
    allianceTag,
  );
  const hasOwner = await allianceHasOwner(hqAllianceId);
  const ashedAccessRole = userAllianceAccessRole(ashedAlliance, currentUser);
  const connectingRole = resolveAshedConnectRole({
    wasAllianceCreated: wasCreated,
    allianceHasOwner: hasOwner,
    ashedAccessRole,
  });

  const { hqUserId, mergedFromHqUserId } =
    await resolveCanonicalHqUserForAshedConnect({
      ashedUserId: currentUser.id,
      ashedEmail: currentUser.email,
      displayName: currentUser.full_name,
      authHqUserId,
    });

  const rosterEmails = buildAllianceRosterEmails(ashedAlliance);

  for (const email of rosterEmails) {
    const stubUserId = await resolveRosterHqUserId(email);
    if (!stubUserId) {
      continue;
    }
    const roleName = resolveSystemRoleForAlliance(ashedAlliance, { email });
    await upsertAshedMembership(hqAllianceId, stubUserId, roleName);
  }

  await upsertAshedMembership(hqAllianceId, hqUserId, connectingRole);

  await revokeStaleAshedMemberships(hqAllianceId, rosterEmails);

  if (sessionId) {
    const db = getDb();
    await db
      .update(schema.sessions)
      .set({
        hqUserId,
        currentAllianceId: hqAllianceId,
        updatedAt: new Date(),
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  return {
    hqUserId,
    hqAllianceId,
    roleName: connectingRole,
    mergedFromHqUserId,
  };
}

export async function syncAshedAllianceRoles(options: {
  connection: ParsedConnection;
  sessionId: string;
  allianceTag: string;
  currentUser: AshedUserInfo;
  authHqUserId?: string | null;
}): Promise<SyncAshedAllianceRolesResult> {
  return syncAshedAllianceRolesCore(options);
}

/** Bot onboarding: sync alliance roles without mutating web sessions. */
export async function syncAshedAllianceForBot(options: {
  connection: ParsedConnection;
  allianceTag: string;
  currentUser: AshedUserInfo;
}): Promise<SyncAshedAllianceRolesResult> {
  return syncAshedAllianceRolesCore({
    ...options,
    authHqUserId: undefined,
  });
}

export type TeamMember = {
  email: string;
  displayName: string | null;
  roleName: string;
  source: string;
};

export async function getAllianceTeam(
  hqAllianceId: string,
): Promise<TeamMember[]> {
  const db = getDb();
  const rows = await db
    .select({
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
      roleName: schema.roles.name,
      source: schema.allianceMemberships.source,
    })
    .from(schema.allianceMemberships)
    .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, hqAllianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    );

  return rows.sort((a, b) => a.email.localeCompare(b.email));
}
