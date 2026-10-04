import "server-only";

import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";

export type CredentialShareAuditEntry = {
  id: string;
  action: string;
  allianceId: string | null;
  hqUserId: string | null;
  shareId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** Client-safe audit row — omits actor ids and metadata payloads. */
export type PublicCredentialShareAuditEntry = {
  id: string;
  action: string;
  shareId: string | null;
  createdAt: string;
};

export function toPublicCredentialShareAuditEntry(
  entry: CredentialShareAuditEntry,
): PublicCredentialShareAuditEntry {
  return {
    id: entry.id,
    action: entry.action,
    shareId: entry.shareId,
    createdAt: entry.createdAt,
  };
}

export async function writeCredentialShareAudit(input: {
  sessionId: string | null;
  allianceId: string;
  hqUserId: string;
  shareId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: input.action,
    resourceType: "ashed_credential_share",
    resourceId: input.shareId,
    metadata: {
      shareId: input.shareId,
      ...input.metadata,
    },
  });
}

function viewerCredentialShareActivityCondition(viewerHqUserId: string): SQL {
  return or(
    eq(schema.auditLog.hqUserId, viewerHqUserId),
    sql`${schema.auditLog.metadata}->>'ownerHqUserId' = ${viewerHqUserId}`,
  )!;
}

export async function listCredentialShareActivity(input: {
  shareId?: string;
  allianceId?: string;
  hqUserId?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: CredentialShareAuditEntry[]; nextCursor: string | null }> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

  const conditions = [
    eq(schema.auditLog.resourceType, "ashed_credential_share"),
  ];

  if (input.shareId) {
    conditions.push(eq(schema.auditLog.resourceId, input.shareId));
  }
  if (input.allianceId) {
    conditions.push(eq(schema.auditLog.allianceId, input.allianceId));
  }
  if (input.hqUserId) {
    conditions.push(viewerCredentialShareActivityCondition(input.hqUserId));
  }
  if (input.cursor) {
    conditions.push(lt(schema.auditLog.id, input.cursor));
  }

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(and(...conditions))
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => ({
      id: row.id,
      action: row.action,
      allianceId: row.allianceId,
      hqUserId: row.hqUserId,
      shareId: row.resourceId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function listRecentAllianceShareActivity(
  allianceId: string,
  limit = 5,
): Promise<PublicCredentialShareAuditEntry[]> {
  const { items } = await listCredentialShareActivity({
    allianceId,
    limit,
  });
  return items.map(toPublicCredentialShareAuditEntry);
}

export async function userCanViewFullCredentialShareHistory(input: {
  hqUserId: string;
  isPlatformMaintainer: boolean;
  hasAshedUserId: boolean;
  shareOwnerHqUserId?: string;
}): Promise<boolean> {
  if (input.isPlatformMaintainer) {
    return true;
  }
  if (input.hasAshedUserId) {
    return true;
  }
  if (input.shareOwnerHqUserId && input.shareOwnerHqUserId === input.hqUserId) {
    return true;
  }
  return false;
}

export async function countShareActivityForOwnerOnDate(
  ownerHqUserId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.resourceType, "ashed_credential_share"),
        viewerCredentialShareActivityCondition(ownerHqUserId),
        sql`${schema.auditLog.createdAt} >= ${dayStart}`,
        sql`${schema.auditLog.createdAt} < ${dayEnd}`,
      ),
    );
  return row?.count ?? 0;
}
