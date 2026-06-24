import "server-only";

import { createHash, randomBytes } from "crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

import { provisionAllianceMembership } from "./provision-membership";
import { assertAllianceLinkedGameServer } from "./alliance-server-gate.server";

const DEFAULT_JOIN_CODE_TTL_DAYS = 7;

function hashJoinCode(code: string): string {
  const normalized = normalizeJoinCode(code);
  return createHash("sha256").update(normalized).digest("hex");
}

export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function joinCodeHint(code: string): string {
  const normalized = normalizeJoinCode(code);
  return normalized.length <= 4
    ? normalized
    : `…${normalized.slice(-4)}`;
}

function generateJoinCode(allianceTag?: string | null): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  const prefix = allianceTag?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "HQ";
  return `${prefix}-${suffix}`;
}

export type CreateAllianceJoinCodeInput = {
  allianceId: string;
  roleName: SystemRoleName;
  maxRedemptions: number;
  expiresInDays?: number;
  adminLabel?: string | null;
  code?: string | null;
  createdByHqUserId?: string | null;
};

export type CreateAllianceJoinCodeResult = {
  joinCodeId: string;
  code: string;
  codeHint: string;
  expiresAt: string;
  maxRedemptions: number;
  roleName: SystemRoleName;
};

export async function createAllianceJoinCode(
  input: CreateAllianceJoinCodeInput,
): Promise<CreateAllianceJoinCodeResult> {
  if (input.maxRedemptions < 1) {
    throw new Error("Max redemptions must be at least 1.");
  }

  const roleId = ROLE_IDS[input.roleName];
  if (!roleId) {
    throw new Error("Invalid role.");
  }

  const db = getDb();
  const [alliance] = await db
    .select({ id: schema.alliances.id, tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }

  await assertAllianceLinkedGameServer(input.allianceId);

  const ttlDays = input.expiresInDays ?? DEFAULT_JOIN_CODE_TTL_DAYS;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  let plaintext = input.code?.trim()
    ? normalizeJoinCode(input.code)
    : generateJoinCode(alliance.tag);
  if (!plaintext) {
    plaintext = generateJoinCode(null);
  }

  const joinCodeId = nanoid(16);
  await db.insert(schema.hqAllianceJoinCodes).values({
    id: joinCodeId,
    allianceId: input.allianceId,
    roleId,
    codeHash: hashJoinCode(plaintext),
    codeHint: joinCodeHint(plaintext),
    maxRedemptions: input.maxRedemptions,
    redemptionCount: 0,
    expiresAt,
    adminLabel: input.adminLabel?.trim() || null,
    createdByHqUserId: input.createdByHqUserId ?? null,
    createdAt: now,
  });

  return {
    joinCodeId,
    code: plaintext,
    codeHint: joinCodeHint(plaintext),
    expiresAt: expiresAt.toISOString(),
    maxRedemptions: input.maxRedemptions,
    roleName: input.roleName,
  };
}

export type RedeemAllianceJoinCodeInput = {
  code: string;
  hqUserId: string;
  sessionId: string;
  userLabel?: string | null;
};

export async function redeemAllianceJoinCode(
  input: RedeemAllianceJoinCodeInput,
) {
  const normalized = normalizeJoinCode(input.code);
  if (!normalized) {
    throw new Error("Join code is required.");
  }

  const db = getDb();
  const codeHash = hashJoinCode(normalized);
  const now = new Date();

  const [joinCode] = await db
    .select()
    .from(schema.hqAllianceJoinCodes)
    .where(eq(schema.hqAllianceJoinCodes.codeHash, codeHash))
    .limit(1);

  if (!joinCode) {
    throw new Error("Join code not found.");
  }

  if (joinCode.revokedAt) {
    throw new Error("This join code has been revoked.");
  }

  if (joinCode.expiresAt <= now) {
    throw new Error("This join code has expired.");
  }

  const [existingRedemption] = await db
    .select({ id: schema.hqAllianceJoinCodeRedemptions.id })
    .from(schema.hqAllianceJoinCodeRedemptions)
    .where(
      and(
        eq(schema.hqAllianceJoinCodeRedemptions.joinCodeId, joinCode.id),
        eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, input.hqUserId),
      ),
    )
    .limit(1);

  if (existingRedemption) {
    return provisionAllianceMembership({
      hqUserId: input.hqUserId,
      sessionId: input.sessionId,
      allianceId: joinCode.allianceId,
      roleId: joinCode.roleId,
      userLabel: input.userLabel,
    });
  }

  if (joinCode.redemptionCount >= joinCode.maxRedemptions) {
    throw new Error("This join code has reached its redemption limit.");
  }

  const [updated] = await db
    .update(schema.hqAllianceJoinCodes)
    .set({
      redemptionCount: joinCode.redemptionCount + 1,
    })
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.id, joinCode.id),
        isNull(schema.hqAllianceJoinCodes.revokedAt),
        gt(schema.hqAllianceJoinCodes.expiresAt, now),
        eq(
          schema.hqAllianceJoinCodes.redemptionCount,
          joinCode.redemptionCount,
        ),
      ),
    )
    .returning({ id: schema.hqAllianceJoinCodes.id });

  if (!updated) {
    throw new Error("This join code is no longer available.");
  }

  await db.insert(schema.hqAllianceJoinCodeRedemptions).values({
    id: nanoid(16),
    joinCodeId: joinCode.id,
    hqUserId: input.hqUserId,
    redeemedAt: now,
  });

  const [user] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, input.hqUserId))
    .limit(1);

  const result = await provisionAllianceMembership({
    hqUserId: input.hqUserId,
    sessionId: input.sessionId,
    allianceId: joinCode.allianceId,
    roleId: joinCode.roleId,
    userLabel: input.userLabel,
    ownerEmail:
      systemRoleNameForId(joinCode.roleId) === "owner"
        ? user?.email ?? null
        : null,
  });

  return result;
}

export async function revokeAllianceJoinCode(joinCodeId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.hqAllianceJoinCodes)
    .set({ revokedAt: now })
    .where(eq(schema.hqAllianceJoinCodes.id, joinCodeId));
}
