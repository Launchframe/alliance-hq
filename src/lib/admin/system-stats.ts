import { asc, count, desc, eq, inArray } from "drizzle-orm";

import { buildAdminAlliancesQuery } from "@/lib/admin/admin-alliances-query.server";
import type { AdminAlliancesQueryParams } from "@/lib/admin/admin-alliances-query.shared";
import { getDb, schema } from "@/lib/db";
import { getDatabaseHost } from "@/lib/db/url";

export type SystemStats = {
  database: { ok: boolean; host: string; error?: string };
  counts: {
    hqUsers: number;
    platformMaintainers: number;
    alliances: number;
    memberships: number;
    videoJobs: number;
    videoJobsQueued: number;
    videoJobsFailed: number;
    auditLogEntries: number;
    hqEvents: number;
    hqEventSeries: number;
    commendations: number;
  };
  config: {
    platformBootstrapEmailConfigured: boolean;
    videoWorkerSecretConfigured: boolean;
    cronSecretConfigured: boolean;
    r2Configured: boolean;
    tokenEncryptionConfigured: boolean;
  };
  recentQueuedJobs: Array<{
    id: string;
    fileName: string | null;
    createdAt: Date;
  }>;
};

export async function loadSystemStats(): Promise<SystemStats> {
  const db = getDb();
  let databaseOk = true;
  let databaseError: string | undefined;

  let databaseHost = "unknown";
  try {
    databaseHost = getDatabaseHost();
  } catch {
    // env not configured — host stays unknown
  }

  try {
    await db.select({ id: schema.sessions.id }).from(schema.sessions).limit(1);
  } catch (error) {
    databaseOk = false;
    databaseError =
      error instanceof Error ? error.message : "Database unreachable";
  }

  const [
    hqUsers,
    platformMaintainers,
    alliances,
    memberships,
    videoJobs,
    videoJobsQueued,
    videoJobsFailed,
    auditLogEntries,
    hqEvents,
    hqEventSeries,
    commendations,
    recentQueuedJobs,
  ] = await Promise.all([
    db.select({ count: count() }).from(schema.hqUsers),
    db
      .select({ count: count() })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.isPlatformMaintainer, 1)),
    db.select({ count: count() }).from(schema.alliances),
    db.select({ count: count() }).from(schema.allianceMemberships),
    db.select({ count: count() }).from(schema.videoJobs),
    db
      .select({ count: count() })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "queued")),
    db
      .select({ count: count() })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "failed")),
    db.select({ count: count() }).from(schema.auditLog),
    db.select({ count: count() }).from(schema.hqEvents),
    db.select({ count: count() }).from(schema.hqEventSeries),
    db.select({ count: count() }).from(schema.hqCommendations),
    db
      .select({
        id: schema.videoJobs.id,
        fileName: schema.videoJobs.fileName,
        createdAt: schema.videoJobs.createdAt,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.status, "queued"))
      .orderBy(desc(schema.videoJobs.createdAt))
      .limit(10),
  ]);

  return {
    database: { ok: databaseOk, host: databaseHost, error: databaseError },
    counts: {
      hqUsers: hqUsers[0]?.count ?? 0,
      platformMaintainers: platformMaintainers[0]?.count ?? 0,
      alliances: alliances[0]?.count ?? 0,
      memberships: memberships[0]?.count ?? 0,
      videoJobs: videoJobs[0]?.count ?? 0,
      videoJobsQueued: videoJobsQueued[0]?.count ?? 0,
      videoJobsFailed: videoJobsFailed[0]?.count ?? 0,
      auditLogEntries: auditLogEntries[0]?.count ?? 0,
      hqEvents: hqEvents[0]?.count ?? 0,
      hqEventSeries: hqEventSeries[0]?.count ?? 0,
      commendations: commendations[0]?.count ?? 0,
    },
    config: {
      platformBootstrapEmailConfigured: Boolean(
        process.env.PLATFORM_BOOTSTRAP_EMAIL?.trim(),
      ),
      videoWorkerSecretConfigured: Boolean(process.env.VIDEO_WORKER_SECRET),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      r2Configured: Boolean(
        process.env.R2_ACCOUNT_ID &&
          process.env.R2_ACCESS_KEY_ID &&
          process.env.R2_SECRET_ACCESS_KEY &&
          process.env.R2_BUCKET,
      ),
      tokenEncryptionConfigured: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
    },
    recentQueuedJobs,
  };
}

export async function loadAdminAlliances(params: AdminAlliancesQueryParams) {
  const db = getDb();
  const query = buildAdminAlliancesQuery(params);
  const orderFn = query.order === "desc" ? desc : asc;

  const [alliances, totalRow] = await Promise.all([
    db
      .select()
      .from(schema.alliances)
      .where(query.where)
      .orderBy(orderFn(query.orderBy))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: count() })
      .from(schema.alliances)
      .where(query.where),
  ]);

  const allianceIds = alliances.map((alliance) => alliance.id);
  const membershipCounts =
    allianceIds.length > 0
      ? await db
          .select({
            allianceId: schema.allianceMemberships.allianceId,
            count: count(),
          })
          .from(schema.allianceMemberships)
          .where(inArray(schema.allianceMemberships.allianceId, allianceIds))
          .groupBy(schema.allianceMemberships.allianceId)
      : [];

  const countByAlliance = new Map(
    membershipCounts.map((row) => [row.allianceId, row.count]),
  );

  return {
    alliances: alliances.map((alliance) => ({
      id: alliance.id,
      slug: alliance.slug,
      tag: alliance.tag,
      name: alliance.name,
      ashedAllianceId: alliance.ashedAllianceId,
      operatingMode: alliance.operatingMode,
      ownerEmail: alliance.ownerEmail,
      collaborators: alliance.collaboratorsJson ?? [],
      rolesSyncedAt: alliance.rolesSyncedAt,
      memberCount: countByAlliance.get(alliance.id) ?? 0,
      createdAt: alliance.createdAt,
      updatedAt: alliance.updatedAt,
    })),
    total: totalRow[0]?.count ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function loadAdminRolesWithPermissions() {
  const db = getDb();
  const roles = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.isSystem, 1))
    .orderBy(schema.roles.name);

  const rolePermissions = await db
    .select({
      roleId: schema.rolePermissions.roleId,
      permissionId: schema.rolePermissions.permissionId,
    })
    .from(schema.rolePermissions);

  const permissionsByRole = new Map<string, string[]>();
  for (const row of rolePermissions) {
    const list = permissionsByRole.get(row.roleId) ?? [];
    list.push(row.permissionId);
    permissionsByRole.set(row.roleId, list);
  }

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: (permissionsByRole.get(role.id) ?? []).sort(),
  }));
}
