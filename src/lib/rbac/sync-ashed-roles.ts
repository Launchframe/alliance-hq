import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { forwardJson } from "@/lib/bff/session";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";

import { ROLE_IDS, type SystemRoleName } from "./constants";

type AshedAllianceRow = {
  id?: string;
  tag?: string;
  name?: string;
  owner_id?: string;
  owner_email?: string;
  collaborators?: string[];
};

export type AshedUserInfo = {
  id?: string;
  email: string;
  full_name?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugFromTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function resolveRoleForEmail(
  email: string,
  ashedUserId: string | undefined,
  alliance: AshedAllianceRow,
): SystemRoleName {
  const normalized = normalizeEmail(email);
  const ownerEmail = alliance.owner_email
    ? normalizeEmail(alliance.owner_email)
    : null;

  if (
    (ownerEmail && normalized === ownerEmail) ||
    (alliance.owner_id && ashedUserId && alliance.owner_id === ashedUserId)
  ) {
    return "owner";
  }

  const collaborators = (alliance.collaborators ?? []).map(normalizeEmail);
  if (collaborators.includes(normalized)) {
    return "maintainer";
  }

  return "viewer";
}

async function fetchAllianceByTag(
  connection: ParsedConnection,
  allianceTag: string,
): Promise<AshedAllianceRow | null> {
  const upstream = await forwardJson(connection, "/entities/Alliance", {
    method: "GET",
  });
  if (!upstream.ok) {
    throw new Error(`Failed to fetch Alliance list (${upstream.status})`);
  }

  const rows = (await upstream.json()) as AshedAllianceRow[];
  const tagLower = allianceTag.trim().toLowerCase();
  return (
    rows.find((row) => row.tag?.trim().toLowerCase() === tagLower) ?? null
  );
}

export async function upsertHqUser(user: AshedUserInfo) {
  const db = getDb();
  const email = normalizeEmail(user.email);
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
  const collaborators = (ashedAlliance.collaborators ?? []).map(normalizeEmail);

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
        name: ashedAlliance.name ?? existing.name,
        ownerAshedUserId: ashedAlliance.owner_id ?? null,
        ownerEmail: ashedAlliance.owner_email
          ? normalizeEmail(ashedAlliance.owner_email)
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
    name: ashedAlliance.name ?? allianceTag,
    ashedAllianceId: ashedAlliance.id ?? null,
    ownerAshedUserId: ashedAlliance.owner_id ?? null,
    ownerEmail: ashedAlliance.owner_email
      ? normalizeEmail(ashedAlliance.owner_email)
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

  const rosterEmails = new Set<string>();
  if (ashedAlliance.owner_email) {
    rosterEmails.add(normalizeEmail(ashedAlliance.owner_email));
  }
  for (const email of ashedAlliance.collaborators ?? []) {
    rosterEmails.add(normalizeEmail(email));
  }

  for (const email of rosterEmails) {
    const stubUserId = await upsertHqUserStub(email);
    const roleName = resolveRoleForEmail(email, undefined, ashedAlliance);
    await upsertAshedMembership(hqAllianceId, stubUserId, roleName);
  }

  const currentRole = resolveRoleForEmail(
    currentUser.email,
    currentUser.id,
    ashedAlliance,
  );
  await upsertAshedMembership(hqAllianceId, hqUserId, currentRole);

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
