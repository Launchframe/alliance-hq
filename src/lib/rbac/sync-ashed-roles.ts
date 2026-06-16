import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  resolveSystemRoleForAlliance,
  normalizeAshedEmail,
} from "@/lib/alliance/accessible";
import {
  buildAllianceRosterEmails,
  shouldRevokeAshedMembership,
} from "@/lib/rbac/sync-ashed-roles.helpers";
import type { AshedAllianceRow, AshedUserRef } from "@/lib/alliance/types";
import { base44ListAlliances } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";

import { ROLE_IDS, type SystemRoleName } from "./constants";

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

export async function upsertHqUser(user: AshedUserInfo) {
  const db = getDb();
  const email = normalizeAshedEmail(user.email);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(schema.hqUsers)
      .set({
        displayName: user.full_name ?? existing.displayName,
        ashedUserId: user.id ?? existing.ashedUserId,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, existing.id));
    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email,
    displayName: user.full_name ?? null,
    ashedUserId: user.id ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function upsertHqUserStub(email: string) {
  return upsertHqUser({ email });
}

async function upsertAllianceFromAshed(
  ashedAlliance: AshedAllianceRow,
  allianceTag: string,
) {
  const db = getDb();
  const now = new Date();
  const slug = slugFromTag(allianceTag);
  const tag = ashedAlliance.tag?.trim() || allianceTag.trim();
  const collaborators = (ashedAlliance.collaborators ?? []).map(normalizeAshedEmail);

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
        updatedAt: now,
      })
      .where(eq(schema.alliances.id, existing.id));
    return existing.id;
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
    createdAt: now,
    updatedAt: now,
  });
  return id;
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

export async function syncAshedAllianceRoles(options: {
  connection: ParsedConnection;
  sessionId: string;
  allianceTag: string;
  currentUser: AshedUserInfo;
}): Promise<{ hqUserId: string; hqAllianceId: string; roleName: SystemRoleName }> {
  const { connection, sessionId, allianceTag, currentUser } = options;
  const ashedAlliance = await fetchAllianceByTag(connection, allianceTag);
  if (!ashedAlliance?.id) {
    throw new Error(`Alliance "${allianceTag}" not found in Ashed.`);
  }

  const hqAllianceId = await upsertAllianceFromAshed(ashedAlliance, allianceTag);
  const hqUserId = await upsertHqUser(currentUser);

  const rosterEmails = buildAllianceRosterEmails(ashedAlliance);

  for (const email of rosterEmails) {
    const stubUserId = await upsertHqUserStub(email);
    const roleName = resolveSystemRoleForAlliance(ashedAlliance, { email });
    await upsertAshedMembership(hqAllianceId, stubUserId, roleName);
  }

  const currentRole = resolveSystemRoleForAlliance(ashedAlliance, currentUser);
  await upsertAshedMembership(hqAllianceId, hqUserId, currentRole);

  await revokeStaleAshedMemberships(hqAllianceId, rosterEmails);

  const db = getDb();
  await db
    .update(schema.sessions)
    .set({
      hqUserId,
      currentAllianceId: hqAllianceId,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));

  return { hqUserId, hqAllianceId, roleName: currentRole };
}

/** Bot onboarding: sync alliance roles without mutating web sessions. */
export async function syncAshedAllianceForBot(options: {
  connection: ParsedConnection;
  allianceTag: string;
  currentUser: AshedUserInfo;
}): Promise<{ hqUserId: string; hqAllianceId: string; roleName: SystemRoleName }> {
  const { connection, allianceTag, currentUser } = options;
  const ashedAlliance = await fetchAllianceByTag(connection, allianceTag);
  if (!ashedAlliance?.id) {
    throw new Error(`Alliance "${allianceTag}" not found in Ashed.`);
  }

  const hqAllianceId = await upsertAllianceFromAshed(ashedAlliance, allianceTag);
  const hqUserId = await upsertHqUser(currentUser);

  const rosterEmails = buildAllianceRosterEmails(ashedAlliance);

  for (const email of rosterEmails) {
    const stubUserId = await upsertHqUserStub(email);
    const roleName = resolveSystemRoleForAlliance(ashedAlliance, { email });
    await upsertAshedMembership(hqAllianceId, stubUserId, roleName);
  }

  const currentRole = resolveSystemRoleForAlliance(ashedAlliance, currentUser);
  await upsertAshedMembership(hqAllianceId, hqUserId, currentRole);

  await revokeStaleAshedMemberships(hqAllianceId, rosterEmails);

  return { hqUserId, hqAllianceId, roleName: currentRole };
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
