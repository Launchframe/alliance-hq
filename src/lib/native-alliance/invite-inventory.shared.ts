export type InviteInventoryItemKind =
  | "invite_link"
  | "join_code"
  | "commander_claim";

export type InviteInventoryDepletedReason =
  | "expired"
  | "revoked"
  | "uses_exhausted"
  | "accepted";

export type InviteInventoryItem = {
  id: string;
  kind: InviteInventoryItemKind;
  inviteKind?: "email" | "protected_link" | "discord_officer";
  roleName: string;
  adminLabel: string | null;
  email: string | null;
  codeHint: string | null;
  targetCommanderName: string | null;
  maxRedemptions: number | null;
  redemptionCount: number | null;
  usesRemaining: number | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  status: "valid" | "depleted";
  depletedReason: InviteInventoryDepletedReason | null;
};

export type InviteInventoryPayload = {
  valid: InviteInventoryItem[];
  depleted: InviteInventoryItem[];
};

export type InventoryAllianceOption = {
  id: string;
  name: string;
  tag: string | null;
  slug: string;
};

export type InventoryFilterKind =
  | "all"
  | "invite_link"
  | "join_code"
  | "commander_claim";

export function matchesInventoryDateRange(
  isoString: string,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true;
  const date = isoString.slice(0, 10);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function classifyJoinCodeStatus(input: {
  revokedAt: Date | null;
  expiresAt: Date;
  redemptionCount: number;
  maxRedemptions: number;
  now?: Date;
}): { status: "valid" | "depleted"; depletedReason: InviteInventoryDepletedReason | null } {
  const now = input.now ?? new Date();
  if (input.revokedAt) {
    return { status: "depleted", depletedReason: "revoked" };
  }
  if (input.expiresAt <= now) {
    return { status: "depleted", depletedReason: "expired" };
  }
  if (input.redemptionCount >= input.maxRedemptions) {
    return { status: "depleted", depletedReason: "uses_exhausted" };
  }
  return { status: "valid", depletedReason: null };
}

export function classifyInviteLinkStatus(input: {
  acceptedAt: Date | null;
  expiresAt: Date;
  revokedAt?: Date | null;
  now?: Date;
}): { status: "valid" | "depleted"; depletedReason: InviteInventoryDepletedReason | null } {
  const now = input.now ?? new Date();
  if (input.revokedAt) {
    return { status: "depleted", depletedReason: "revoked" };
  }
  if (input.acceptedAt) {
    return { status: "depleted", depletedReason: "accepted" };
  }
  if (input.expiresAt <= now) {
    return { status: "depleted", depletedReason: "expired" };
  }
  return { status: "valid", depletedReason: null };
}
