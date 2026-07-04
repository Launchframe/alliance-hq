import "server-only";

import { createHash, randomBytes } from "crypto";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { auditInviteAccepted } from "@/lib/onboarding/onboarding-audit.server";
import {
  generateHumanPassphrase,
  hashPassphrase,
  verifyPassphrase,
} from "@/lib/auth/passphrase";
import {
  resolveInviteRedirect,
  resolvePostInviteOnboardingRedirect,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";
import {
  ASHED_CONNECT_PERMISSION,
  ROLE_IDS,
  type SystemRoleName,
} from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";
import { getLinkedMemberIds } from "@/lib/vr/repository";

import { provisionAllianceMembership } from "./provision-membership";

const INVITE_TTL_DAYS = 14;

export type HqInviteKind = "email" | "protected_link" | "discord_officer";

export type CommanderClaimInviteErrorCode =
  | "commander_not_found"
  | "commander_already_claimed";

/** Raised when a claim invite target is invalid or already bound to a user. */
export class CommanderClaimInviteError extends Error {
  readonly code: CommanderClaimInviteErrorCode;
  constructor(code: CommanderClaimInviteErrorCode, message: string) {
    super(message);
    this.name = "CommanderClaimInviteError";
    this.code = code;
  }
}

/**
 * Resolve the bound commander for a claim invite, asserting it exists in the
 * alliance roster and is not already claimed by a user. Returns the
 * commander display name (never the UID — see player-uid-privacy.mdc).
 */
export async function assertCommanderClaimTargetClaimable(
  allianceId: string,
  ashedMemberId: string,
): Promise<{ commanderName: string }> {
  const db = getDb();
  const [member] = await db
    .select({
      currentName: schema.allianceMembers.currentName,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  if (!member || member.status === "former") {
    throw new CommanderClaimInviteError(
      "commander_not_found",
      "Commander is not an active roster member.",
    );
  }

  const linkedMemberIds = await getLinkedMemberIds(allianceId);
  if (linkedMemberIds.has(ashedMemberId)) {
    throw new CommanderClaimInviteError(
      "commander_already_claimed",
      "This commander is already linked to an account.",
    );
  }

  return { commanderName: member.currentName };
}

async function ensureSystemRoleSeeded(
  roleName: SystemRoleName,
): Promise<void> {
  const db = getDb();
  const roleId = ROLE_IDS[roleName];

  const [existingRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.id, roleId))
    .limit(1);

  if (!existingRole) {
    await db
      .insert(schema.roles)
      .values({
        id: roleId,
        allianceId: null,
        name: roleName,
        description:
          roleName === "member"
            ? "HQ member — read-only access to alliance resources and personal account settings"
            : `${roleName} system role`,
        isSystem: 1,
      })
      .onConflictDoNothing();
  }

  if (roleName !== "member") {
    await db
      .insert(schema.permissions)
      .values({
        id: ASHED_CONNECT_PERMISSION,
        description: "Connect an Ashed account to HQ",
      })
      .onConflictDoNothing();

    await db
      .insert(schema.rolePermissions)
      .values({ roleId, permissionId: ASHED_CONNECT_PERMISSION })
      .onConflictDoNothing();
    return;
  }

  const [existingMemberPerm] = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId))
    .limit(1);

  if (existingMemberPerm) {
    return;
  }

  const viewerRoleId = ROLE_IDS.viewer;
  const viewerPerms = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, viewerRoleId));

  if (viewerPerms.length === 0) {
    return;
  }

  await Promise.all(
    viewerPerms.map((row) =>
      db
        .insert(schema.rolePermissions)
        .values({ roleId, permissionId: row.permissionId })
        .onConflictDoNothing(),
    ),
  );
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteAcceptUrl(
  token: string,
  origin: string,
  redirectPath?: string | null,
): string {
  const base = `${origin.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  const safeRedirect = sanitizeInternalRedirectPath(redirectPath);
  if (!safeRedirect) {
    return base;
  }
  return `${base}?next=${encodeURIComponent(safeRedirect)}`;
}

export type CreateHqInviteInput = {
  allianceId: string;
  kind?: HqInviteKind;
  email?: string | null;
  roleName: SystemRoleName;
  invitedByHqUserId?: string | null;
  origin: string;
  redirectPath?: string | null;
  adminLabel?: string | null;
  targetDiscordUserId?: string | null;
  /** Roster member (ashed_member_id) this invite claims, if a commander claim invite. */
  targetAshedMemberId?: string | null;
};

export type CreateHqInviteResult = {
  inviteId: string;
  inviteUrl: string;
  expiresAt: string;
  email: string | null;
  roleName: SystemRoleName;
  kind: HqInviteKind;
  passphrase?: string;
  adminLabel?: string | null;
  targetAshedMemberId?: string | null;
  targetCommanderName?: string | null;
};

export async function createHqInvite(
  input: CreateHqInviteInput,
): Promise<CreateHqInviteResult> {
  const kind: HqInviteKind = input.kind ?? "email";
  const roleId = ROLE_IDS[input.roleName];
  if (!roleId) {
    throw new Error("Invalid invite role.");
  }

  await ensureSystemRoleSeeded(input.roleName);

  const db = getDb();
  const [alliance] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }

  const targetAshedMemberId = input.targetAshedMemberId?.trim() || null;
  let targetCommanderName: string | null = null;
  if (targetAshedMemberId) {
    if (input.roleName !== "member") {
      throw new Error("Invalid invite role.");
    }
    const target = await assertCommanderClaimTargetClaimable(
      input.allianceId,
      targetAshedMemberId,
    );
    targetCommanderName = target.commanderName;
  }

  let email: string | null = null;
  let passphrase: string | undefined;
  let passphraseHash: string | null = null;

  if (kind === "email") {
    email = normalizeAshedEmail(input.email?.trim() ?? "");
    if (!email) {
      throw new Error("Invite email is required.");
    }
  } else if (kind === "protected_link") {
    passphrase = generateHumanPassphrase();
    passphraseHash = await hashPassphrase(passphrase);
  } else if (kind === "discord_officer") {
    throw new Error("Discord officer invites require Auth Phase 2.");
  }

  const redirectPath = sanitizeInternalRedirectPath(input.redirectPath);
  const { token, tokenHash } = generateInviteToken();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);
  const inviteId = nanoid(16);

  await db.insert(schema.hqInvites).values({
    id: inviteId,
    allianceId: input.allianceId,
    kind,
    email,
    roleId,
    tokenHash,
    passphraseHash,
    adminLabel: input.adminLabel?.trim() || null,
    targetDiscordUserId: input.targetDiscordUserId?.trim() || null,
    targetAshedMemberId,
    requireMemberLink: input.kind === "discord_officer" ? 1 : 0,
    invitedByHqUserId: input.invitedByHqUserId ?? null,
    redirectPath,
    expiresAt,
    createdAt: now,
  });

  return {
    inviteId,
    inviteUrl: inviteAcceptUrl(token, input.origin, redirectPath),
    expiresAt: expiresAt.toISOString(),
    email,
    roleName: input.roleName,
    kind,
    passphrase,
    adminLabel: input.adminLabel?.trim() || null,
    targetAshedMemberId,
    targetCommanderName,
  };
}

export type BulkClaimInviteSkip = {
  ashedMemberId: string;
  code: CommanderClaimInviteErrorCode;
};

export type CreateHqClaimInvitesBulkResult = {
  created: CreateHqInviteResult[];
  skipped: BulkClaimInviteSkip[];
};

/**
 * Generate commander claim invites for several roster commanders in one pass.
 * Each invite is an independent protected-link "member" claim invite (same as
 * the single-claim flow). Commanders that are not on the roster or already
 * linked are skipped (collected in `skipped`) rather than aborting the batch;
 * non-claim errors (alliance gate, schema, db) bubble up to the caller.
 *
 * Duplicate ids in the input are de-duplicated. Never returns or logs the
 * player UID — `ashedMemberId` is the internal roster id (see
 * player-uid-privacy.mdc).
 */
export async function createHqClaimInvitesBulk(input: {
  allianceId: string;
  targetAshedMemberIds: string[];
  invitedByHqUserId?: string | null;
  origin: string;
  redirectPath?: string | null;
  adminLabel?: string | null;
}): Promise<CreateHqClaimInvitesBulkResult> {
  const created: CreateHqInviteResult[] = [];
  const skipped: BulkClaimInviteSkip[] = [];
  const seen = new Set<string>();

  for (const rawId of input.targetAshedMemberIds) {
    const ashedMemberId = rawId.trim();
    if (!ashedMemberId || seen.has(ashedMemberId)) {
      continue;
    }
    seen.add(ashedMemberId);

    try {
      const invite = await createHqInvite({
        allianceId: input.allianceId,
        kind: "protected_link",
        roleName: "member",
        invitedByHqUserId: input.invitedByHqUserId,
        origin: input.origin,
        redirectPath: input.redirectPath,
        adminLabel: input.adminLabel,
        targetAshedMemberId: ashedMemberId,
      });
      created.push(invite);
    } catch (error) {
      if (error instanceof CommanderClaimInviteError) {
        skipped.push({ ashedMemberId, code: error.code });
        continue;
      }
      throw error;
    }
  }

  return { created, skipped };
}

export type HqInvitePreview = {
  allianceName: string;
  allianceTag: string | null;
  roleName: SystemRoleName | null;
  expiresAt: string;
  expired: boolean;
  accepted: boolean;
  redirectPath: string | null;
  kind: HqInviteKind;
  requiresPassphrase: boolean;
  requiresDiscordLogin: boolean;
  boundEmail: string | null;
  /** Commander display name when this is a commander claim invite (never UID). */
  targetCommanderName: string | null;
};

export async function loadHqInvitePreview(
  token: string,
): Promise<HqInvitePreview | null> {
  const tokenHash = hashInviteToken(token.trim());
  const db = getDb();
  const [row] = await db
    .select({
      allianceId: schema.hqInvites.allianceId,
      expiresAt: schema.hqInvites.expiresAt,
      acceptedAt: schema.hqInvites.acceptedAt,
      roleId: schema.hqInvites.roleId,
      redirectPath: schema.hqInvites.redirectPath,
      kind: schema.hqInvites.kind,
      email: schema.hqInvites.email,
      targetDiscordUserId: schema.hqInvites.targetDiscordUserId,
      targetAshedMemberId: schema.hqInvites.targetAshedMemberId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
    })
    .from(schema.hqInvites)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqInvites.allianceId),
    )
    .where(eq(schema.hqInvites.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;

  let targetCommanderName: string | null = null;
  if (row.targetAshedMemberId) {
    const [member] = await db
      .select({ currentName: schema.allianceMembers.currentName })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, row.allianceId),
          eq(schema.allianceMembers.ashedMemberId, row.targetAshedMemberId),
        ),
      )
      .limit(1);
    targetCommanderName = member?.currentName ?? null;
  }

  const kind = (row.kind ?? "email") as HqInviteKind;
  const now = new Date();
  return {
    allianceName: row.allianceName,
    allianceTag: row.allianceTag,
    roleName: systemRoleNameForId(row.roleId),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt <= now,
    accepted: row.acceptedAt != null,
    redirectPath: row.redirectPath,
    kind,
    requiresPassphrase: kind === "protected_link" || kind === "discord_officer",
    requiresDiscordLogin: kind === "discord_officer",
    boundEmail: row.email,
    targetCommanderName,
  };
}

/**
 * Most-recent accepted commander claim for an HQ user in an alliance
 * (protected-link invite or claim join-code redemption).
 * Drives the streamlined onboarding "confirm your commander" step.
 */
export async function findAcceptedClaimInviteForUser(
  allianceId: string,
  hqUserId: string,
): Promise<{ inviteId: string; targetAshedMemberId: string } | null> {
  const db = getDb();
  const [inviteRow] = await db
    .select({
      id: schema.hqInvites.id,
      targetAshedMemberId: schema.hqInvites.targetAshedMemberId,
    })
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.allianceId, allianceId),
        eq(schema.hqInvites.acceptedByHqUserId, hqUserId),
        isNotNull(schema.hqInvites.acceptedAt),
        isNotNull(schema.hqInvites.targetAshedMemberId),
      ),
    )
    .orderBy(desc(schema.hqInvites.acceptedAt))
    .limit(1);

  if (inviteRow?.targetAshedMemberId) {
    return {
      inviteId: inviteRow.id,
      targetAshedMemberId: inviteRow.targetAshedMemberId,
    };
  }

  const [joinRow] = await db
    .select({
      id: schema.hqAllianceJoinCodes.id,
      targetAshedMemberId: schema.hqAllianceJoinCodes.targetAshedMemberId,
    })
    .from(schema.hqAllianceJoinCodeRedemptions)
    .innerJoin(
      schema.hqAllianceJoinCodes,
      eq(
        schema.hqAllianceJoinCodeRedemptions.joinCodeId,
        schema.hqAllianceJoinCodes.id,
      ),
    )
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.allianceId, allianceId),
        eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, hqUserId),
        isNotNull(schema.hqAllianceJoinCodes.targetAshedMemberId),
      ),
    )
    .orderBy(desc(schema.hqAllianceJoinCodeRedemptions.redeemedAt))
    .limit(1);

  if (!joinRow?.targetAshedMemberId) return null;
  return {
    inviteId: joinRow.id,
    targetAshedMemberId: joinRow.targetAshedMemberId,
  };
}

export function resolveHqInviteAcceptRedirect(options: {
  queryNext?: string | null;
  storedPath?: string | null;
}): string {
  return resolvePostInviteOnboardingRedirect(options);
}

async function upsertHqUserByEmail(email: string, displayName?: string | null) {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  if (existing) {
    if (displayName?.trim() && !existing.displayName) {
      await db
        .update(schema.hqUsers)
        .set({ displayName: displayName.trim(), updatedAt: now })
        .where(eq(schema.hqUsers.id, existing.id));
    }
    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email,
    displayName: displayName?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export type AcceptHqInviteInput = {
  token: string;
  sessionId: string;
  hqUserId: string;
  userEmail: string;
  displayName?: string | null;
  email?: string | null;
  passphrase?: string | null;
};

export type AcceptHqInviteResult = {
  allianceId: string;
  allianceTag: string;
  allianceName: string;
  hqUserId: string;
  roleName: SystemRoleName | null;
  redirectPath: string | null;
  /** Set when the accepted invite binds a specific roster commander to claim. */
  targetAshedMemberId: string | null;
};

export async function rebindAcceptedInviteSession(input: {
  token: string;
  sessionId: string;
  hqUserId: string;
  userEmail: string;
}): Promise<AcceptHqInviteResult | null> {
  const tokenHash = hashInviteToken(input.token.trim());
  const normalizedEmail = normalizeAshedEmail(input.userEmail);
  const db = getDb();

  const [invite] = await db
    .select()
    .from(schema.hqInvites)
    .where(eq(schema.hqInvites.tokenHash, tokenHash))
    .limit(1);

  if (!invite?.acceptedAt) {
    return null;
  }

  const kind = (invite.kind ?? "email") as HqInviteKind;
  if (kind === "email" && invite.email) {
    if (normalizedEmail !== normalizeAshedEmail(invite.email)) {
      throw new Error("Email does not match this invite.");
    }
  }

  if (invite.acceptedByHqUserId && invite.acceptedByHqUserId !== input.hqUserId) {
    throw new Error("This invite belongs to another account.");
  }

  const [alliance] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, invite.allianceId))
    .limit(1);

  if (!alliance?.tag?.trim()) {
    throw new Error("Alliance tag is missing.");
  }

  return provisionAllianceMembership({
    hqUserId: input.hqUserId,
    sessionId: input.sessionId,
    allianceId: invite.allianceId,
    roleId: invite.roleId,
    userLabel: normalizedEmail,
    ownerEmail:
      systemRoleNameForId(invite.roleId) === "owner" ? normalizedEmail : null,
  }).then((result) => ({
    ...result,
    redirectPath: invite.redirectPath,
    targetAshedMemberId: invite.targetAshedMemberId ?? null,
  }));
}

export async function acceptHqInvite(
  input: AcceptHqInviteInput,
): Promise<AcceptHqInviteResult> {
  const tokenHash = hashInviteToken(input.token.trim());
  const sessionEmail = normalizeAshedEmail(input.userEmail);
  if (!sessionEmail) {
    throw new Error("Signed-in email is required.");
  }

  const db = getDb();
  const [invite] = await db
    .select()
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.tokenHash, tokenHash),
        isNull(schema.hqInvites.acceptedAt),
      ),
    )
    .limit(1);

  if (!invite) {
    const rebound = await rebindAcceptedInviteSession({
      token: input.token,
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      userEmail: input.userEmail,
    });
    if (rebound) {
      return rebound;
    }
    throw new Error("Invite not found or already used.");
  }

  if (invite.expiresAt <= new Date()) {
    throw new Error("Invite has expired.");
  }

  const kind = (invite.kind ?? "email") as HqInviteKind;

  if (kind === "email") {
    const submittedEmail = normalizeAshedEmail(input.email?.trim() ?? "");
    if (!submittedEmail) {
      throw new Error("Email is required.");
    }
    if (submittedEmail !== normalizeAshedEmail(invite.email ?? "")) {
      throw new Error("Email does not match this invite.");
    }
    if (submittedEmail !== sessionEmail) {
      throw new Error("Sign in with the email address on this invite.");
    }
  } else if (kind === "protected_link") {
    if (!invite.passphraseHash) {
      throw new Error("Invite passphrase is missing.");
    }
    if (invite.passphraseConsumedAt) {
      throw new Error("Passphrase already used.");
    }
    const passphrase = input.passphrase?.trim() ?? "";
    if (!passphrase) {
      throw new Error("Passphrase is required.");
    }
    const valid = await verifyPassphrase(passphrase, invite.passphraseHash);
    if (!valid) {
      throw new Error("Incorrect passphrase.");
    }
  } else if (kind === "discord_officer") {
    throw new Error("Discord officer invites require Auth Phase 2.");
  }

  const hqUserId = input.hqUserId;
  const now = new Date();

  const acceptedRows = await db
    .update(schema.hqInvites)
    .set({
      acceptedAt: now,
      acceptedByHqUserId: hqUserId,
      ...(kind === "protected_link" ? { passphraseConsumedAt: now } : {}),
    })
    .where(
      and(
        eq(schema.hqInvites.id, invite.id),
        isNull(schema.hqInvites.acceptedAt),
      ),
    )
    .returning({ id: schema.hqInvites.id });

  if (acceptedRows.length === 0) {
    throw new Error("Invite not found or already used.");
  }

  await db
    .delete(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, input.sessionId));

  const result = await provisionAllianceMembership({
    hqUserId,
    sessionId: input.sessionId,
    allianceId: invite.allianceId,
    roleId: invite.roleId,
    userLabel: input.displayName?.trim() || sessionEmail,
    ownerEmail:
      systemRoleNameForId(invite.roleId) === "owner" ? sessionEmail : null,
  });

  await auditInviteAccepted({
    sessionId: input.sessionId,
    allianceId: invite.allianceId,
    hqUserId,
    inviteId: invite.id,
    inviteKind: kind,
    roleName: result.roleName,
  });

  return {
    ...result,
    redirectPath: invite.redirectPath,
    targetAshedMemberId: invite.targetAshedMemberId ?? null,
  };
}

/** @deprecated Legacy anonymous accept — use acceptHqInvite with hqUserId instead. */
export async function acceptHqInviteLegacy(input: {
  token: string;
  sessionId: string;
  email: string;
  displayName?: string | null;
}): Promise<AcceptHqInviteResult> {
  const email = normalizeAshedEmail(input.email.trim());
  if (!email) {
    throw new Error("Email is required.");
  }
  const hqUserId = await upsertHqUserByEmail(email, input.displayName);
  return acceptHqInvite({
    token: input.token,
    sessionId: input.sessionId,
    hqUserId,
    userEmail: email,
    email,
    displayName: input.displayName,
  });
}

export { resolveInviteRedirect };
