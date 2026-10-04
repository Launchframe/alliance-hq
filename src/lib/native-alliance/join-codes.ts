import "server-only";

import { createHash, randomBytes } from "crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { isPostgresUniqueViolation } from "@/lib/auth/postgres-unique.shared";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

import {
  assertCommanderClaimTargetClaimable,
  CommanderClaimInviteError,
} from "./invites";
import { provisionAllianceMembership } from "./provision-membership";

const DEFAULT_JOIN_CODE_TTL_DAYS = 7;
/** Hex suffix entropy for generated codes (8 bytes = 64 bits). */
const GENERATED_JOIN_CODE_SUFFIX_BYTES = 8;
/** Minimum normalized length for officer-supplied custom codes. */
const MIN_CUSTOM_JOIN_CODE_LENGTH = 10;

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
  const suffix = randomBytes(GENERATED_JOIN_CODE_SUFFIX_BYTES)
    .toString("hex")
    .toUpperCase();
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
  /** Commander claim: redeeming this code targets a specific roster member. */
  targetAshedMemberId?: string | null;
};

export type CreateAllianceJoinCodeResult = {
  joinCodeId: string;
  code: string;
  codeHint: string;
  expiresAt: string;
  maxRedemptions: number;
  roleName: SystemRoleName;
  targetAshedMemberId: string | null;
  targetCommanderName: string | null;
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

  const targetAshedMemberId = input.targetAshedMemberId?.trim() || null;
  let targetCommanderName: string | null = null;
  if (targetAshedMemberId) {
    if (input.roleName !== "member") {
      throw new Error("Commander claim codes must use the member role.");
    }
    if (input.maxRedemptions !== 1) {
      throw new Error("Commander claim codes are single-use.");
    }
    try {
      const target = await assertCommanderClaimTargetClaimable(
        input.allianceId,
        targetAshedMemberId,
      );
      targetCommanderName = target.commanderName;
    } catch (error) {
      if (error instanceof CommanderClaimInviteError) {
        throw error;
      }
      throw error;
    }
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

  const ttlDays = input.expiresInDays ?? DEFAULT_JOIN_CODE_TTL_DAYS;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const customCode = Boolean(input.code?.trim());
  let plaintext = customCode
    ? normalizeJoinCode(input.code!)
    : generateJoinCode(alliance.tag);
  if (!plaintext) {
    plaintext = generateJoinCode(null);
  }
  if (customCode && plaintext.length < MIN_CUSTOM_JOIN_CODE_LENGTH) {
    throw new Error(
      `Custom join codes must be at least ${MIN_CUSTOM_JOIN_CODE_LENGTH} characters.`,
    );
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
    targetAshedMemberId,
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
    targetAshedMemberId,
    targetCommanderName,
  };
}

/** Thrown inside the redeem TX when the CAS counter bump loses the race. */
class JoinCodeCasConflictError extends Error {
  constructor() {
    super("JOIN_CODE_CAS_CONFLICT");
    this.name = "JoinCodeCasConflictError";
  }
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
    // Re-visit / auto-redeem remount: refresh session only — do not re-apply
    // the join-code role (blocks silent re-escalation after demotion).
    return provisionAllianceMembership({
      hqUserId: input.hqUserId,
      sessionId: input.sessionId,
      allianceId: joinCode.allianceId,
      roleId: joinCode.roleId,
      rolePolicy: "preserve_existing",
      userLabel: input.userLabel,
    });
  }

  if (joinCode.redemptionCount >= joinCode.maxRedemptions) {
    throw new Error("This join code has reached its redemption limit.");
  }

  // Claim a redemption slot and insert the redemption row atomically.
  // Without a transaction, a successful counter bump followed by a failed
  // insert permanently burns capacity (single-use / last-slot codes become
  // unredeemable with no recovery path for this user).
  try {
    await db.transaction(async (tx) => {
      const [updated] = await tx
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
        throw new JoinCodeCasConflictError();
      }

      await tx.insert(schema.hqAllianceJoinCodeRedemptions).values({
        id: nanoid(16),
        joinCodeId: joinCode.id,
        hqUserId: input.hqUserId,
        redeemedAt: now,
      });
    });
  } catch (error) {
    if (error instanceof JoinCodeCasConflictError) {
      // Concurrent redeem (e.g. URL auto-redeem remount): if this user already
      // won the race, treat as success instead of "no longer available".
      const [racedRedemption] = await db
        .select({ id: schema.hqAllianceJoinCodeRedemptions.id })
        .from(schema.hqAllianceJoinCodeRedemptions)
        .where(
          and(
            eq(schema.hqAllianceJoinCodeRedemptions.joinCodeId, joinCode.id),
            eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, input.hqUserId),
          ),
        )
        .limit(1);
      if (racedRedemption) {
        return provisionAllianceMembership({
          hqUserId: input.hqUserId,
          sessionId: input.sessionId,
          allianceId: joinCode.allianceId,
          roleId: joinCode.roleId,
          rolePolicy: "preserve_existing",
          userLabel: input.userLabel,
        });
      }
      throw new Error("This join code is no longer available.");
    }
    if (isPostgresUniqueViolation(error)) {
      // Concurrent insert won; our counter bump rolled back with the TX.
      return provisionAllianceMembership({
        hqUserId: input.hqUserId,
        sessionId: input.sessionId,
        allianceId: joinCode.allianceId,
        roleId: joinCode.roleId,
        rolePolicy: "preserve_existing",
        userLabel: input.userLabel,
      });
    }
    throw error;
  }

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
