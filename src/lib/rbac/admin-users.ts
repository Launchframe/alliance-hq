import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

import { isSystemRoleId } from "./system-roles";

export type AdminMembershipRow = {
  id: string;
  hqUserId: string;
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  roleId: string;
  roleName: string;
  source: string;
  status: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: Date;
  memberships: AdminMembershipRow[];
};

export type AdminRoleOption = {
  id: string;
  name: string;
  description: string | null;
};

export type AdminAllianceOption = {
  id: string;
  name: string;
  slug: string;
};

export async function loadAdminUsersDirectory(): Promise<{
  users: AdminUserRow[];
  roles: AdminRoleOption[];
  alliances: AdminAllianceOption[];
}> {
  const db = getDb();

  const [users, membershipRows, roles, alliances] = await Promise.all([
    db.select().from(schema.hqUsers).orderBy(desc(schema.hqUsers.createdAt)),
    db
      .select({
        id: schema.allianceMemberships.id,
        hqUserId: schema.allianceMemberships.hqUserId,
        allianceId: schema.allianceMemberships.allianceId,
        allianceName: schema.alliances.name,
        allianceSlug: schema.alliances.slug,
        roleId: schema.allianceMemberships.roleId,
        roleName: schema.roles.name,
        source: schema.allianceMemberships.source,
        status: schema.allianceMemberships.status,
      })
      .from(schema.allianceMemberships)
      .innerJoin(
        schema.alliances,
        eq(schema.alliances.id, schema.allianceMemberships.allianceId),
      )
      .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId)),
    db
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
        description: schema.roles.description,
      })
      .from(schema.roles)
      .where(eq(schema.roles.isSystem, 1)),
    db
      .select({
        id: schema.alliances.id,
        name: schema.alliances.name,
        slug: schema.alliances.slug,
      })
      .from(schema.alliances)
      .orderBy(schema.alliances.name),
  ]);

  const membershipsByUser = new Map<string, AdminMembershipRow[]>();
  for (const row of membershipRows) {
    const list = membershipsByUser.get(row.hqUserId) ?? [];
    list.push(row);
    membershipsByUser.set(row.hqUserId, list);
  }

  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isPlatformMaintainer: user.isPlatformMaintainer === 1,
      createdAt: user.createdAt,
      memberships: (membershipsByUser.get(user.id) ?? []).sort((a, b) =>
        a.allianceName.localeCompare(b.allianceName),
      ),
    })),
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)),
    alliances,
  };
}

export async function setPlatformMaintainer(
  hqUserId: string,
  isPlatformMaintainer: boolean,
) {
  const db = getDb();
  await db
    .update(schema.hqUsers)
    .set({
      isPlatformMaintainer: isPlatformMaintainer ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.hqUsers.id, hqUserId));
}

export async function assignManualMembership(options: {
  hqUserId: string;
  allianceId: string;
  roleId: string;
}) {
  const { hqUserId, allianceId, roleId } = options;
  if (!isSystemRoleId(roleId)) {
    throw new Error("Invalid system role.");
  }

  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.allianceMemberships)
      .set({
        roleId,
        source: "manual",
        status: "active",
        updatedAt: now,
      })
      .where(eq(schema.allianceMemberships.id, existing.id));
    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.allianceMemberships).values({
    id,
    hqUserId,
    allianceId,
    roleId,
    source: "manual",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateManualMembershipRole(
  membershipId: string,
  roleId: string,
) {
  if (!isSystemRoleId(roleId)) {
    throw new Error("Invalid system role.");
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.allianceMemberships)
    .where(eq(schema.allianceMemberships.id, membershipId))
    .limit(1);

  if (!existing) {
    throw new Error("Membership not found.");
  }

  await db
    .update(schema.allianceMemberships)
    .set({
      roleId,
      source: "manual",
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(schema.allianceMemberships.id, membershipId));

  return existing.id;
}
