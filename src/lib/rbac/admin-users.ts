import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  countCompletedDeviceLinksByHqUser,
  countCompletedDeviceLinksForUsers,
} from "@/lib/credential-pairing/device-link-stats";
import { grantHqAccess } from "@/lib/access/invite-gate";
import { loadSignInMethodSnapshot } from "@/lib/auth/account-linking.server";
import type {
  LinkedOAuthProvider,
  OAuthProviderAccountSnapshot,
} from "@/lib/auth/account-linking.shared";
import type { OAuthIdentitySplitRow } from "@/lib/auth/oauth-identity-split.shared";
import {
  hqUserIdsWithOAuthIdentitySplit,
  loadOAuthIdentitySplitForHqUser,
} from "@/lib/auth/oauth-identity-split.server";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";
import { getDb, schema } from "@/lib/db";

import { buildAdminUsersSearchWhere } from "./admin-users-query.server";
import type { AdminUsersQueryParams } from "./admin-users-query.shared";
import { isSystemRoleId } from "./system-roles";

export type AdminMemberLinkRow = {
  id: string;
  hqUserId: string;
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
  ashedMemberId: string;
  memberDisplayName: string | null;
  gameUid: string;
  linkedAt: Date;
};

export type AdminLinkedCommanderMembershipRow = {
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
  ashedMemberId: string;
  status: string;
};

/** Platform-maintainer-only: includes game UID for support. */
export type AdminLinkedCommanderRow = {
  commanderId: string;
  gameUid: string | null;
  primaryName: string | null;
  isPrimary: boolean;
  linkedAt: Date;
  gameServerNumber: number | null;
  powerLevel: string | null;
  currentTotalHeroPower: number | null;
  memberLevel: number | null;
  mainSquad: string | null;
  rosterMemberships: AdminLinkedCommanderMembershipRow[];
};

export type AdminMembershipRow = {
  id: string;
  hqUserId: string;
  allianceId: string;
  allianceName: string;
  allianceSlug: string;
  allianceTag: string | null;
  roleId: string;
  roleName: string;
  source: string;
  status: string;
};

export type AdminUserListRow = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: Date;
  linkedDeviceCount: number;
  oauthIdentitySplit: boolean;
  memberships: Array<{
    allianceSlug: string;
    allianceTag: string | null;
    roleName: string;
  }>;
};

export type AdminUserSignInMethods = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  oauthAccounts: OAuthProviderAccountSnapshot[];
  availableProviders: {
    google: boolean;
    discord: boolean;
  };
  oauthIdentitySplit: boolean;
  oauthIdentitySplits: OAuthIdentitySplitRow[];
};

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  isPlatformMaintainer: boolean;
  createdAt: Date;
  /** Successful device_link pairings issued by this user (additional devices). */
  linkedDeviceCount: number;
  memberships: AdminMembershipRow[];
  memberLinks: AdminMemberLinkRow[];
  linkedCommanders: AdminLinkedCommanderRow[];
  signInMethods: AdminUserSignInMethods | null;
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

async function loadAdminRolesAndAlliances(): Promise<{
  roles: AdminRoleOption[];
  alliances: AdminAllianceOption[];
}> {
  const db = getDb();
  const [roles, alliances] = await Promise.all([
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

  return {
    roles: roles.sort((a, b) => a.name.localeCompare(b.name)),
    alliances,
  };
}

async function loadMembershipRowsForUsers(
  hqUserIds: string[],
): Promise<AdminMembershipRow[]> {
  if (hqUserIds.length === 0) {
    return [];
  }

  const db = getDb();
  return db
    .select({
      id: schema.allianceMemberships.id,
      hqUserId: schema.allianceMemberships.hqUserId,
      allianceId: schema.allianceMemberships.allianceId,
      allianceName: schema.alliances.name,
      allianceSlug: schema.alliances.slug,
      allianceTag: schema.alliances.tag,
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
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(inArray(schema.allianceMemberships.hqUserId, hqUserIds));
}

async function loadMemberLinkRowsForUsers(
  hqUserIds: string[],
): Promise<AdminMemberLinkRow[]> {
  if (hqUserIds.length === 0) {
    return [];
  }

  const db = getDb();
  return db
    .select({
      id: schema.hqMemberLinks.id,
      hqUserId: schema.hqMemberLinks.hqUserId,
      allianceId: schema.hqMemberLinks.allianceId,
      allianceName: schema.alliances.name,
      allianceSlug: schema.alliances.slug,
      allianceTag: schema.alliances.tag,
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      memberDisplayName: schema.hqMemberLinks.memberDisplayName,
      gameUid: schema.hqMemberLinks.gameUid,
      linkedAt: schema.hqMemberLinks.linkedAt,
    })
    .from(schema.hqMemberLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinks.allianceId),
    )
    .where(inArray(schema.hqMemberLinks.hqUserId, hqUserIds));
}

type LinkedCommanderOwnershipRow = AdminLinkedCommanderRow & { hqUserId: string };

async function loadLinkedCommanderRowsForUsers(
  hqUserIds: string[],
): Promise<LinkedCommanderOwnershipRow[]> {
  if (hqUserIds.length === 0) {
    return [];
  }

  const db = getDb();
  const ownershipRows = await db
    .select({
      hqUserId: schema.hqUserCommanders.hqUserId,
      commanderId: schema.commanders.id,
      gameUid: schema.commanders.gameUid,
      primaryName: schema.commanders.primaryName,
      isPrimary: schema.hqUserCommanders.isPrimary,
      linkedAt: schema.hqUserCommanders.linkedAt,
      gameServerNumber: schema.commanders.gameServerNumber,
      powerLevel: schema.commanders.powerLevel,
      currentTotalHeroPower: schema.commanders.currentTotalHeroPower,
      memberLevel: schema.commanders.memberLevel,
      mainSquad: schema.commanders.mainSquad,
    })
    .from(schema.hqUserCommanders)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.hqUserCommanders.commanderId),
    )
    .where(inArray(schema.hqUserCommanders.hqUserId, hqUserIds))
    .orderBy(
      desc(schema.hqUserCommanders.isPrimary),
      desc(schema.hqUserCommanders.linkedAt),
    );

  const commanderIds = [...new Set(ownershipRows.map((row) => row.commanderId))];
  const membershipRows =
    commanderIds.length === 0
      ? []
      : await db
          .select({
            commanderId: schema.commanderAllianceMemberships.commanderId,
            allianceId: schema.commanderAllianceMemberships.allianceId,
            allianceName: schema.alliances.name,
            allianceSlug: schema.alliances.slug,
            allianceTag: schema.alliances.tag,
            ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
            status: schema.commanderAllianceMemberships.status,
          })
          .from(schema.commanderAllianceMemberships)
          .innerJoin(
            schema.alliances,
            eq(schema.alliances.id, schema.commanderAllianceMemberships.allianceId),
          )
          .where(
            inArray(schema.commanderAllianceMemberships.commanderId, commanderIds),
          )
          .orderBy(schema.alliances.name);

  const membershipsByCommander = new Map<
    string,
    AdminLinkedCommanderMembershipRow[]
  >();
  for (const row of membershipRows) {
    const list = membershipsByCommander.get(row.commanderId) ?? [];
    list.push({
      allianceId: row.allianceId,
      allianceName: row.allianceName,
      allianceSlug: row.allianceSlug,
      allianceTag: row.allianceTag,
      ashedMemberId: row.ashedMemberId,
      status: row.status,
    });
    membershipsByCommander.set(row.commanderId, list);
  }

  return ownershipRows.map((row) => ({
    hqUserId: row.hqUserId,
    commanderId: row.commanderId,
    gameUid: row.gameUid,
    primaryName: row.primaryName,
    isPrimary: row.isPrimary,
    linkedAt: row.linkedAt,
    gameServerNumber: row.gameServerNumber,
    powerLevel: row.powerLevel,
    currentTotalHeroPower: row.currentTotalHeroPower,
    memberLevel: row.memberLevel,
    mainSquad: row.mainSquad,
    rosterMemberships: membershipsByCommander.get(row.commanderId) ?? [],
  }));
}

function groupMembershipsByUser(
  rows: AdminMembershipRow[],
): Map<string, AdminMembershipRow[]> {
  const map = new Map<string, AdminMembershipRow[]>();
  for (const row of rows) {
    const list = map.get(row.hqUserId) ?? [];
    list.push(row);
    map.set(row.hqUserId, list);
  }
  return map;
}

function groupMemberLinksByUser(
  rows: AdminMemberLinkRow[],
): Map<string, AdminMemberLinkRow[]> {
  const map = new Map<string, AdminMemberLinkRow[]>();
  for (const row of rows) {
    const list = map.get(row.hqUserId) ?? [];
    list.push(row);
    map.set(row.hqUserId, list);
  }
  return map;
}

function groupLinkedCommandersByUser(
  rows: LinkedCommanderOwnershipRow[],
): Map<string, AdminLinkedCommanderRow[]> {
  const map = new Map<string, AdminLinkedCommanderRow[]>();
  for (const row of rows) {
    const list = map.get(row.hqUserId) ?? [];
    list.push({
      commanderId: row.commanderId,
      gameUid: row.gameUid,
      primaryName: row.primaryName,
      isPrimary: row.isPrimary,
      linkedAt: row.linkedAt,
      gameServerNumber: row.gameServerNumber,
      powerLevel: row.powerLevel,
      currentTotalHeroPower: row.currentTotalHeroPower,
      memberLevel: row.memberLevel,
      mainSquad: row.mainSquad,
      rosterMemberships: row.rosterMemberships,
    });
    map.set(row.hqUserId, list);
  }
  return map;
}

function buildAdminUserRow(
  user: typeof schema.hqUsers.$inferSelect,
  linkedDeviceCount: number,
  memberships: AdminMembershipRow[],
  memberLinks: AdminMemberLinkRow[],
  linkedCommanders: AdminLinkedCommanderRow[],
  signInMethods: AdminUserSignInMethods | null,
): AdminUserRow {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isPlatformMaintainer: user.isPlatformMaintainer === 1,
    createdAt: user.createdAt,
    linkedDeviceCount,
    memberships: memberships.sort((a, b) =>
      a.allianceName.localeCompare(b.allianceName),
    ),
    memberLinks: memberLinks.sort((a, b) =>
      a.allianceName.localeCompare(b.allianceName),
    ),
    linkedCommanders,
    signInMethods,
  };
}

async function loadAdminUserSignInMethods(
  hqUserId: string,
): Promise<AdminUserSignInMethods | null> {
  const snapshot = await loadSignInMethodSnapshot(hqUserId);
  if (!snapshot) {
    return null;
  }

  const [ssoAvailability, splitSummary] = await Promise.all([
    Promise.resolve(getAuthSsoAvailability()),
    loadOAuthIdentitySplitForHqUser(hqUserId),
  ]);

  return {
    email: snapshot.email,
    hasPassword: snapshot.hasPassword,
    passkeyCount: snapshot.passkeyCount,
    linkedProviders: snapshot.linkedProviders,
    oauthAccounts: snapshot.oauthAccounts,
    availableProviders: {
      google: ssoAvailability.google,
      discord: ssoAvailability.discord,
    },
    oauthIdentitySplit: splitSummary.hasSplit,
    oauthIdentitySplits: splitSummary.splits,
  };
}

export async function loadAdminUsersMeta(): Promise<{
  roles: AdminRoleOption[];
  alliances: AdminAllianceOption[];
}> {
  return loadAdminRolesAndAlliances();
}

export async function searchAdminUsers(
  params: Pick<
    AdminUsersQueryParams,
    "q" | "page" | "limit" | "allianceId" | "platformMaintainersOnly"
  >,
): Promise<{
  users: AdminUserListRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const where = buildAdminUsersSearchWhere({
    q: params.q,
    allianceId: params.allianceId,
    platformMaintainersOnly: params.platformMaintainersOnly,
  });

  const offset = (params.page - 1) * params.limit;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqUsers)
    .where(where);

  const total = countRow?.count ?? 0;

  const userRows = await db
    .select()
    .from(schema.hqUsers)
    .where(where)
    .orderBy(desc(schema.hqUsers.createdAt))
    .limit(params.limit)
    .offset(offset);

  const hqUserIds = userRows.map((row) => row.id);
  const [membershipRows, deviceLinkCounts, splitUserIds] = await Promise.all([
    loadMembershipRowsForUsers(hqUserIds),
    countCompletedDeviceLinksForUsers(hqUserIds),
    hqUserIdsWithOAuthIdentitySplit(hqUserIds),
  ]);
  const membershipsByUser = groupMembershipsByUser(membershipRows);

  const users: AdminUserListRow[] = userRows.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isPlatformMaintainer: user.isPlatformMaintainer === 1,
    createdAt: user.createdAt,
    linkedDeviceCount: deviceLinkCounts.get(user.id) ?? 0,
    oauthIdentitySplit: splitUserIds.has(user.id),
    memberships: (membershipsByUser.get(user.id) ?? []).map((membership) => ({
      allianceSlug: membership.allianceSlug,
      allianceTag: membership.allianceTag,
      roleName: membership.roleName,
    })),
  }));

  return {
    users,
    total,
    page: params.page,
    pageSize: params.limit,
  };
}

export async function loadAdminUserById(
  hqUserId: string,
): Promise<AdminUserRow | null> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  if (!user) {
    return null;
  }

  const [membershipRows, memberLinkRows, linkedCommanderRows, deviceLinkCounts, signInMethods] =
    await Promise.all([
    loadMembershipRowsForUsers([hqUserId]),
    loadMemberLinkRowsForUsers([hqUserId]),
    loadLinkedCommanderRowsForUsers([hqUserId]),
    countCompletedDeviceLinksForUsers([hqUserId]),
    loadAdminUserSignInMethods(hqUserId),
  ]);

  return buildAdminUserRow(
    user,
    deviceLinkCounts.get(hqUserId) ?? 0,
    membershipRows,
    memberLinkRows,
    groupLinkedCommandersByUser(linkedCommanderRows).get(hqUserId) ?? [],
    signInMethods,
  );
}

/** @deprecated Prefer searchAdminUsers + loadAdminUserById for admin UI scale. */
export async function loadAdminUsersDirectory(): Promise<{
  users: AdminUserRow[];
  roles: AdminRoleOption[];
  alliances: AdminAllianceOption[];
}> {
  const db = getDb();

  const [users, meta, deviceLinkCounts] = await Promise.all([
    db.select().from(schema.hqUsers).orderBy(desc(schema.hqUsers.createdAt)),
    loadAdminRolesAndAlliances(),
    countCompletedDeviceLinksByHqUser(),
  ]);

  const hqUserIds = users.map((row) => row.id);
  const [membershipRows, memberLinkRows, linkedCommanderRows] = await Promise.all([
    loadMembershipRowsForUsers(hqUserIds),
    loadMemberLinkRowsForUsers(hqUserIds),
    loadLinkedCommanderRowsForUsers(hqUserIds),
  ]);

  const membershipsByUser = groupMembershipsByUser(membershipRows);
  const memberLinksByUser = groupMemberLinksByUser(memberLinkRows);
  const linkedCommandersByUser = groupLinkedCommandersByUser(linkedCommanderRows);

  return {
    users: users.map((user) =>
      buildAdminUserRow(
        user,
        deviceLinkCounts.get(user.id) ?? 0,
        membershipsByUser.get(user.id) ?? [],
        memberLinksByUser.get(user.id) ?? [],
        linkedCommandersByUser.get(user.id) ?? [],
        null,
      ),
    ),
    roles: meta.roles,
    alliances: meta.alliances,
  };
}

export async function countPlatformMaintainers(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.isPlatformMaintainer, 1));
  return row?.count ?? 0;
}

/** Prevent demoting the final platform maintainer and locking out /admin. */
export function canDemotePlatformMaintainer(
  targetIsMaintainer: boolean,
  maintainerCount: number,
): boolean {
  if (!targetIsMaintainer) {
    return true;
  }
  return maintainerCount > 1;
}

export async function setPlatformMaintainer(
  hqUserId: string,
  isPlatformMaintainer: boolean,
) {
  const db = getDb();

  if (!isPlatformMaintainer) {
    const [user] = await db
      .select({ isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, hqUserId))
      .limit(1);

    if (
      !canDemotePlatformMaintainer(
        user?.isPlatformMaintainer === 1,
        await countPlatformMaintainers(),
      )
    ) {
      throw new Error("Cannot remove the last platform maintainer.");
    }
  }

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
    await grantHqAccess(hqUserId);
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

  await grantHqAccess(hqUserId);
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
