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
  now?: Date;
}): { status: "valid" | "depleted"; depletedReason: InviteInventoryDepletedReason | null } {
  const now = input.now ?? new Date();
  if (input.acceptedAt) {
    return { status: "depleted", depletedReason: "accepted" };
  }
  if (input.expiresAt <= now) {
    return { status: "depleted", depletedReason: "expired" };
  }
  return { status: "valid", depletedReason: null };
}
