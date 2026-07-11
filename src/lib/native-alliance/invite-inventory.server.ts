import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import { listSessionAlliances } from "@/lib/alliance/session-memberships";
import { getDb, schema } from "@/lib/db";
import {
  classifyInviteLinkStatus,
  classifyJoinCodeStatus,
  type InventoryAllianceOption,
  type InviteInventoryItem,
  type InviteInventoryPayload,
} from "@/lib/native-alliance/invite-inventory.shared";
import type { HqInviteKind } from "@/lib/native-alliance/invites";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

const INVITE_CAPABLE_ROLES = new Set(["owner", "maintainer", "officer"]);

export async function listAccessibleInventoryAlliances(
  hqUserId: string,
): Promise<InventoryAllianceOption[]> {
  const alliances = await listSessionAlliances(hqUserId);
  const candidates = alliances.filter((a) =>
    INVITE_CAPABLE_ROLES.has(a.roleName),
  );
  if (candidates.length === 0) {
    return [];
  }

  const db = getDb();
  const settingsRows = await db
    .select({
      id: schema.alliances.id,
      ownerHqUserId: schema.alliances.ownerHqUserId,
      inviteOnboardingMinRole: schema.alliances.inviteOnboardingMinRole,
    })
    .from(schema.alliances)
    .where(
      inArray(
        schema.alliances.id,
        candidates.map((a) => a.id),
      ),
    );

  const settingsById = new Map(settingsRows.map((row) => [row.id, row]));

  return candidates
    .filter((membership) => {
      const alliance = settingsById.get(membership.id);
      if (!alliance) {
        return false;
      }
      if (alliance.inviteOnboardingMinRole === "owner") {
        return (
          membership.roleName === "owner" ||
          alliance.ownerHqUserId === hqUserId
        );
      }
      return true;
    })
    .map(({ id, name, tag, slug }) => ({ id, name, tag, slug }));
}

async function loadCommanderNamesByMemberId(
  allianceId: string,
  memberIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(memberIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(eq(schema.allianceMembers.allianceId, allianceId));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (uniqueIds.includes(row.ashedMemberId)) {
      map.set(row.ashedMemberId, row.currentName);
    }
  }
  return map;
}

export async function listAllianceInviteInventory(
  allianceId: string,
): Promise<InviteInventoryPayload> {
  const db = getDb();
  const now = new Date();

  const [inviteRows, joinCodeRows] = await Promise.all([
    db
      .select()
      .from(schema.hqInvites)
      .where(eq(schema.hqInvites.allianceId, allianceId))
      .orderBy(desc(schema.hqInvites.createdAt)),
    db
      .select()
      .from(schema.hqAllianceJoinCodes)
      .where(eq(schema.hqAllianceJoinCodes.allianceId, allianceId))
      .orderBy(desc(schema.hqAllianceJoinCodes.createdAt)),
  ]);

  const commanderNames = await loadCommanderNamesByMemberId(
    allianceId,
    joinCodeRows
      .map((row) => row.targetAshedMemberId)
      .filter((id): id is string => Boolean(id)),
  );

  const items: InviteInventoryItem[] = [];

  for (const row of inviteRows) {
    const inviteKind = (row.kind ?? "email") as HqInviteKind;
    if (inviteKind === "discord_officer") {
      continue;
    }

    const { status, depletedReason } = classifyInviteLinkStatus({
      acceptedAt: row.acceptedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      now,
    });

    items.push({
      id: row.id,
      kind: "invite_link",
      inviteKind,
      roleName: systemRoleNameForId(row.roleId) ?? "member",
      adminLabel: row.adminLabel,
      email: row.email,
      codeHint: null,
      targetCommanderName: null,
      maxRedemptions: null,
      redemptionCount: null,
      usesRemaining: null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status,
      depletedReason,
    });
  }

  for (const row of joinCodeRows) {
    const { status, depletedReason } = classifyJoinCodeStatus({
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
      redemptionCount: row.redemptionCount,
      maxRedemptions: row.maxRedemptions,
      now,
    });

    const targetAshedMemberId = row.targetAshedMemberId?.trim() || null;
    const usesRemaining = Math.max(0, row.maxRedemptions - row.redemptionCount);

    items.push({
      id: row.id,
      kind: targetAshedMemberId ? "commander_claim" : "join_code",
      roleName: systemRoleNameForId(row.roleId) ?? "member",
      adminLabel: row.adminLabel,
      email: null,
      codeHint: row.codeHint,
      targetCommanderName: targetAshedMemberId
        ? (commanderNames.get(targetAshedMemberId) ?? null)
        : null,
      maxRedemptions: row.maxRedemptions,
      redemptionCount: row.redemptionCount,
      usesRemaining,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status,
      depletedReason,
    });
  }

  items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return {
    valid: items.filter((item) => item.status === "valid"),
    depleted: items.filter((item) => item.status === "depleted"),
  };
}
