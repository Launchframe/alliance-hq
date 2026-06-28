#!/usr/bin/env tsx
/**
 * Seed the dev/preview test-account matrix.
 *
 * Builds two alliances (one ashed-mode, one native-mode) and, for each, every
 * system role twice (with and without a fake Ashed connection), plus a single
 * platform-maintainer account. Idempotent: re-running upserts by natural keys.
 *
 * Usage:
 *   npm run seed:test-matrix
 *   npm run seed:test-matrix -- --tag MYTAG   # override ashed-mode alliance tag
 *
 * Requires system roles/permissions to exist first: `npm run db:seed-rbac`.
 * Refuses to run when VERCEL_ENV=production.
 */
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

config({ path: ".env" });
config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.development.local" });
}

import { getDb, schema } from "@/lib/db";
import {
  buildTestMatrixAccounts,
  TEST_MATRIX_ALLIANCES,
  type TestMatrixAccount,
  type TestMatrixAllianceKey,
} from "@/lib/dev/test-matrix";
import {
  DEFAULT_MAX_BASE_VR,
  gameSeasonIdForNumber,
  gameServerIdForNumber,
} from "@/lib/game-season/game-servers.shared";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { NATIVE_ROSTER_ASHED_ALLIANCE_ID } from "@/lib/native-alliance/constants";

const APP_PORT = process.env.PORT?.trim() || "5175";
const QUICK_SWITCH_HINT = `http://localhost:${APP_PORT}/ (Dev quick-switch panel)`;

function parseTagOverride(argv: string[]): string | null {
  const idx = argv.findIndex((a) => a === "--tag");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1].trim();
  }
  const inline = argv.find((a) => a.startsWith("--tag="));
  if (inline) {
    return inline.slice("--tag=".length).trim();
  }
  return null;
}

function allianceSlug(key: TestMatrixAllianceKey): string {
  return `test-matrix-${key}`;
}

async function upsertTestGameServer(serverNumber: number): Promise<string> {
  const db = getDb();
  const now = new Date();
  const seasonNumber = 1;
  const seasonId = gameSeasonIdForNumber(seasonNumber);
  const gameServerId = gameServerIdForNumber(serverNumber);

  await db
    .insert(schema.gameSeasons)
    .values({
      id: seasonId,
      seasonNumber,
      maxBaseVr: DEFAULT_MAX_BASE_VR,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.gameServers)
    .values({
      id: gameServerId,
      serverNumber,
      seasonId,
      seasonKeySynced: String(seasonNumber),
      seasonKeySource: "default",
      seasonIsPostSeason: 0,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.gameServers.serverNumber,
      set: {
        seasonId,
        seasonKeySynced: String(seasonNumber),
        seasonKeySource: "default",
        seasonIsPostSeason: 0,
        syncedAt: now,
        updatedAt: now,
      },
    });

  return gameServerId;
}

async function assertRbacSeeded(): Promise<void> {
  const db = getDb();
  const [ownerRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.id, ROLE_IDS.owner))
    .limit(1);
  if (!ownerRole) {
    throw new Error(
      "System roles missing. Run `npm run db:seed-rbac` before seeding the test matrix.",
    );
  }
}

async function upsertAlliance(
  key: TestMatrixAllianceKey,
  tag: string,
): Promise<string> {
  const db = getDb();
  const spec = TEST_MATRIX_ALLIANCES.find((a) => a.key === key)!;
  const slug = allianceSlug(key);
  const now = new Date();
  const gameServerId = await upsertTestGameServer(spec.gameServerNumber);

  const [existing] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.slug, slug))
    .limit(1);

  if (existing) {
    await db
      .update(schema.alliances)
      .set({
        tag,
        name: spec.name,
        operatingMode: spec.mode,
        gameServerNumber: spec.gameServerNumber,
        gameServerId,
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
    name: spec.name,
    operatingMode: spec.mode,
    gameServerNumber: spec.gameServerNumber,
    gameServerId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function upsertHqUser(account: TestMatrixAccount): Promise<string> {
  const db = getDb();
  const now = new Date();
  const email = account.email.toLowerCase();

  const [existing] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  const fields = {
    displayName: account.displayName,
    ashedUserId: account.ashedUserId,
    isPlatformMaintainer: account.platformMaintainer ? 1 : 0,
    accessGrantedAt: now,
    emailVerifiedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.hqUsers)
      .set(fields)
      .where(eq(schema.hqUsers.id, existing.id));
    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email,
    createdAt: now,
    ...fields,
  });
  return id;
}

async function upsertMembership(
  hqUserId: string,
  allianceId: string,
  roleId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({ id: schema.allianceMemberships.id })
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
      .set({ roleId, source: "manual", status: "active", updatedAt: now })
      .where(eq(schema.allianceMemberships.id, existing.id));
    return;
  }

  await db.insert(schema.allianceMemberships).values({
    id: nanoid(16),
    hqUserId,
    allianceId,
    roleId,
    source: "manual",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Native-mode shells gate on an HQ member link (and otherwise redirect to the
 * member-link onboarding). Create a roster member + link so the seeded account
 * lands directly in the app shell. UID is a throwaway test value.
 */
async function upsertNativeMemberLink(
  account: TestMatrixAccount,
  hqUserId: string,
  allianceId: string,
  uidSeed: number,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const ashedMemberId = `tm-${account.allianceKey}-${account.role}-${
    account.ashed ? "ashed" : "noashed"
  }`;
  const gameUid = String(900000000000 + uidSeed);

  const [member] = await db
    .select({ id: schema.allianceMembers.id })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  if (member) {
    await db
      .update(schema.allianceMembers)
      .set({ currentName: account.displayName, gameUid, updatedAt: now })
      .where(eq(schema.allianceMembers.id, member.id));
  } else {
    await db.insert(schema.allianceMembers).values({
      id: nanoid(16),
      allianceId,
      ashedMemberId,
      ashedAllianceId: NATIVE_ROSTER_ASHED_ALLIANCE_ID,
      currentName: account.displayName,
      status: "active",
      gameUid,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  const [link] = await db
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);

  if (link) {
    await db
      .update(schema.hqMemberLinks)
      .set({ ashedMemberId, memberDisplayName: account.displayName, gameUid, updatedAt: now })
      .where(eq(schema.hqMemberLinks.id, link.id));
    return;
  }

  await db.insert(schema.hqMemberLinks).values({
    id: nanoid(16),
    allianceId,
    hqUserId,
    ashedMemberId,
    memberDisplayName: account.displayName,
    gameUid,
    linkedAt: now,
    updatedAt: now,
  });
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV === "production") {
    console.error("Refusing to seed the test matrix in production.");
    process.exit(1);
  }

  await assertRbacSeeded();

  const tagOverride = parseTagOverride(process.argv.slice(2));
  const allianceIds = new Map<TestMatrixAllianceKey, string>();
  for (const spec of TEST_MATRIX_ALLIANCES) {
    const tag =
      spec.key === "ashed" && tagOverride ? tagOverride : spec.defaultTag;
    allianceIds.set(spec.key, await upsertAlliance(spec.key, tag));
  }

  const accounts = buildTestMatrixAccounts();
  let uidSeed = 0;
  const summary: Array<{ role: string; alliance: string; ashed: string }> = [];

  for (const account of accounts) {
    const allianceId = allianceIds.get(account.allianceKey)!;
    const hqUserId = await upsertHqUser(account);

    if (account.role) {
      await upsertMembership(hqUserId, allianceId, ROLE_IDS[account.role]);
      if (account.mode === "native") {
        await upsertNativeMemberLink(account, hqUserId, allianceId, uidSeed++);
      }
    }

    summary.push({
      role: account.platformMaintainer ? "platform-maintainer" : account.role!,
      alliance: `${account.allianceTag} (${account.mode})`,
      ashed: account.ashed ? "yes" : "no",
    });
  }

  console.log(`Seeded ${accounts.length} test-matrix accounts:`);
  console.table(summary);
  console.log("");
  console.log(`Switch between them from: ${QUICK_SWITCH_HINT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
