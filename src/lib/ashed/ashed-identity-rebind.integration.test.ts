import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rebindAshedIdentityToSession } from "@/lib/ashed/rebind-session";
import { encryptSecret } from "@/lib/crypto/encrypt";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
} from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { resolveCanonicalHqUserForAshedConnect } from "@/lib/rbac/resolve-canonical-hq-user";
import { getAshedConnection } from "@/lib/session";

const databaseUrl =
  process.env.E2E_DATABASE_URL?.trim() ||
  process.env.LOCAL_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

const describeIntegration = databaseUrl ? describe : describe.skip;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function insertRoleIfNeeded(roleName: keyof typeof ROLE_IDS) {
  const db = getDb();
  const roleId = ROLE_IDS[roleName];
  const now = new Date();
  await db
    .insert(schema.roles)
    .values({
      id: roleId,
      allianceId: null,
      name: roleName,
      description: `${roleName} system role`,
      isSystem: 1,
      createdAt: now,
    })
    .onConflictDoNothing();
}

async function createAlliance() {
  const db = getDb();
  const now = new Date();
  const allianceId = nanoid(16);
  const tag = `RB${randomBytes(2).toString("hex").toUpperCase()}`;

  await db.insert(schema.alliances).values({
    id: allianceId,
    slug: `rebind-${nanoid(6)}`,
    tag,
    name: "Rebind Test Alliance",
    operatingMode: "native",
    createdAt: now,
    updatedAt: now,
  });

  return { allianceId, tag };
}

async function createHqUser(email: string, ashedUserId?: string | null) {
  const db = getDb();
  const now = new Date();
  const id = nanoid(16);

  await db.insert(schema.hqUsers).values({
    id,
    email: email.toLowerCase(),
    displayName: email.split("@")[0],
    ashedUserId: ashedUserId ?? null,
    accessGrantedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

async function createSession(hqUserId: string) {
  const db = getDb();
  const now = new Date();
  const id = nanoid(32);
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  await db.insert(schema.sessions).values({
    id,
    hqUserId,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  return id;
}

async function createMembership(
  hqUserId: string,
  allianceId: string,
  roleName: keyof typeof ROLE_IDS,
  source: "manual" | "ashed",
) {
  const db = getDb();
  const now = new Date();
  await insertRoleIfNeeded(roleName);
  const roleId = ROLE_IDS[roleName];

  const [existing] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, hqUserId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.allianceMemberships)
      .set({
        roleId,
        source,
        status: "active",
        updatedAt: now,
      })
      .where(eq(schema.allianceMemberships.id, existing.id));
    return;
  }

  await db.insert(schema.allianceMemberships).values({
    id: nanoid(16),
    allianceId,
    hqUserId,
    roleId,
    source,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function attachCredential(sessionId: string, ashedUserId: string) {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await db.insert(schema.ashedCredentials).values({
    id: nanoid(24),
    sessionId,
    ashedUserId,
    appId: DEFAULT_APP_ID,
    originUrl: DEFAULT_ORIGIN_URL,
    encryptedToken: encryptSecret("integration-test-token"),
    tokenExpiresAt: expiresAt,
    expiryReminderDays: 14,
    createdAt: now,
    updatedAt: now,
  });
}

async function countCredentialsForSession(sessionId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.ashedCredentials.id })
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId));
  return rows.length;
}

async function activeMembershipRole(
  hqUserId: string,
  allianceId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ roleName: schema.roles.name, source: schema.allianceMemberships.source })
    .from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return `${row.roleName}:${row.source}`;
}

describeIntegration("Ashed identity rebind (integration)", () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeEach(() => {
    cleanup.length = 0;
  });

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
  });

  it("rebind removes duplicate credentials and orphan ashed officer memberships", async () => {
    const ashedUserId = `ashed-${nanoid(12)}`;
    const ashedEmail = uniqueEmail("player");
    const { allianceId } = await createAlliance();

    const orphanA = await createHqUser(uniqueEmail("magic-a"));
    const orphanB = await createHqUser(ashedEmail);
    const sessionA = await createSession(orphanA);
    const sessionB = await createSession(orphanB);

    cleanup.push(async () => {
      const db = getDb();
      await db.delete(schema.ashedCredentials).where(
        eq(schema.ashedCredentials.ashedUserId, ashedUserId),
      );
      await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionA));
      await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionB));
      await db
        .delete(schema.allianceMemberships)
        .where(eq(schema.allianceMemberships.allianceId, allianceId));
      await db.delete(schema.alliances).where(eq(schema.alliances.id, allianceId));
      for (const id of [orphanA, orphanB]) {
        await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
      }
      const [canonical] = await db
        .select({ id: schema.hqUsers.id })
        .from(schema.hqUsers)
        .where(eq(schema.hqUsers.ashedUserId, ashedUserId))
        .limit(1);
      if (canonical) {
        await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, canonical.id));
      }
    });

    await createMembership(orphanA, allianceId, "member", "manual");

    const { hqUserId: canonicalId, mergedFromHqUserId: mergedFromFirst } =
      await resolveCanonicalHqUserForAshedConnect({
        ashedUserId,
        ashedEmail,
        authHqUserId: orphanA,
      });

    expect(canonicalId).toBe(orphanA);
    expect(mergedFromFirst).toBeUndefined();

    await createMembership(canonicalId, allianceId, "officer", "ashed");
    await attachCredential(sessionA, ashedUserId);

    const { hqUserId: canonicalAfterB, mergedFromHqUserId: mergedFromB } =
      await resolveCanonicalHqUserForAshedConnect({
        ashedUserId,
        ashedEmail,
        authHqUserId: orphanB,
      });

    expect(canonicalAfterB).toBe(canonicalId);
    expect(mergedFromB).toBe(orphanB);

    await createMembership(orphanB, allianceId, "officer", "ashed");
    await attachCredential(sessionB, ashedUserId);

    const rebindResult = await rebindAshedIdentityToSession({
      ashedUserId,
      canonicalHqUserId: canonicalId,
      sessionId: sessionB,
      mergedFromHqUserId: orphanB,
      allianceId,
    });

    expect(rebindResult.revokedCredentialSessions).toBe(1);
    expect(rebindResult.revokedMemberships).toBe(1);
    expect(await countCredentialsForSession(sessionA)).toBe(0);
    expect(await countCredentialsForSession(sessionB)).toBe(1);
    expect(await activeMembershipRole(canonicalId, allianceId)).toBe(
      "officer:ashed",
    );
    expect(await activeMembershipRole(orphanB, allianceId)).toBeNull();
  });

  it("resolveCanonicalHqUserForAshedConnect rejects conflicting Ashed identity on email row", async () => {
    const email = uniqueEmail("conflict");
    const firstAshed = `ashed-${nanoid(8)}`;
    const secondAshed = `ashed-${nanoid(8)}`;

    const hqUserId = await createHqUser(email, firstAshed);
    cleanup.push(async () => {
      const db = getDb();
      await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, hqUserId));
    });

    await expect(
      resolveCanonicalHqUserForAshedConnect({
        ashedUserId: secondAshed,
        ashedEmail: email,
        authHqUserId: nanoid(16),
      }),
    ).rejects.toThrow(/already linked to a different HQ user/i);
  });

  it("resolveCanonicalHqUserForAshedConnect rejects hijack from another signed-in HQ account", async () => {
    const ashedUserId = `ashed-${nanoid(12)}`;
    const ashedEmail = uniqueEmail("maintainer");
    const canonicalId = await createHqUser(ashedEmail, ashedUserId);
    const intruderId = await createHqUser(uniqueEmail("google-intruder"));

    cleanup.push(async () => {
      const db = getDb();
      for (const id of [canonicalId, intruderId]) {
        await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
      }
    });

    await expect(
      resolveCanonicalHqUserForAshedConnect({
        ashedUserId,
        ashedEmail,
        authHqUserId: intruderId,
      }),
    ).rejects.toThrow(/different HQ sign-in/i);
  });

  it("getAshedConnection clears credentials that do not match the bound HQ user", async () => {
    const ashedUserId = `ashed-${nanoid(12)}`;
    const userA = await createHqUser(uniqueEmail("user-a"), ashedUserId);
    const userB = await createHqUser(uniqueEmail("user-b"));
    const sessionId = await createSession(userA);

    await attachCredential(sessionId, ashedUserId);

    const db = getDb();
    cleanup.push(async () => {
      await db
        .delete(schema.ashedCredentials)
        .where(eq(schema.ashedCredentials.sessionId, sessionId));
      await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
      for (const id of [userA, userB]) {
        await db.delete(schema.hqUsers).where(eq(schema.hqUsers.id, id));
      }
    });

    expect(await getAshedConnection(sessionId)).not.toBeNull();

    await db
      .update(schema.sessions)
      .set({ hqUserId: userB, updatedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));

    expect(await getAshedConnection(sessionId)).toBeNull();
    expect(await countCredentialsForSession(sessionId)).toBe(0);
  });
});
