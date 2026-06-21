import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";

export async function revokeAshedMembershipsForHqUser(
  hqUserId: string,
  allianceId?: string | null,
): Promise<number> {
  const db = getDb();
  const now = new Date();

  const conditions = [
    eq(schema.allianceMemberships.hqUserId, hqUserId),
    eq(schema.allianceMemberships.source, "ashed"),
    eq(schema.allianceMemberships.status, "active"),
  ];
  if (allianceId) {
    conditions.push(eq(schema.allianceMemberships.allianceId, allianceId));
  }

  const rows = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(and(...conditions));

  for (const row of rows) {
    await db
      .update(schema.allianceMemberships)
      .set({ status: "revoked", updatedAt: now })
      .where(eq(schema.allianceMemberships.id, row.id));
  }

  return rows.length;
}

export async function rebindAshedIdentityToSession(input: {
  ashedUserId: string;
  canonicalHqUserId: string;
  sessionId: string;
  mergedFromHqUserId?: string | null;
  allianceId?: string | null;
}): Promise<{ revokedCredentialSessions: number; revokedMemberships: number }> {
  const db = getDb();
  const now = new Date();
  const ashedUserId = input.ashedUserId.trim();

  const duplicateCredentials = await db
    .select({
      id: schema.ashedCredentials.id,
      sessionId: schema.ashedCredentials.sessionId,
    })
    .from(schema.ashedCredentials)
    .where(
      and(
        eq(schema.ashedCredentials.ashedUserId, ashedUserId),
        ne(schema.ashedCredentials.sessionId, input.sessionId),
      ),
    );

  for (const cred of duplicateCredentials) {
    await db
      .delete(schema.ashedCredentials)
      .where(eq(schema.ashedCredentials.id, cred.id));

    await db
      .update(schema.sessions)
      .set({
        allianceId: null,
        allianceTag: null,
        updatedAt: now,
      })
      .where(eq(schema.sessions.id, cred.sessionId));
  }

  let revokedMemberships = 0;
  const orphanIds = new Set<string>();
  if (input.mergedFromHqUserId && input.mergedFromHqUserId !== input.canonicalHqUserId) {
    orphanIds.add(input.mergedFromHqUserId);
  }

  for (const orphanId of orphanIds) {
    revokedMemberships += await revokeAshedMembershipsForHqUser(
      orphanId,
      input.allianceId,
    );
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId ?? null,
    hqUserId: input.canonicalHqUserId,
    action: "ashed.rebind",
    resourceType: "ashed_identity",
    resourceId: ashedUserId,
    metadata: {
      revokedCredentialSessions: duplicateCredentials.length,
      revokedMemberships,
      mergedFromHqUserId: input.mergedFromHqUserId ?? null,
    },
  });

  return {
    revokedCredentialSessions: duplicateCredentials.length,
    revokedMemberships,
  };
}
