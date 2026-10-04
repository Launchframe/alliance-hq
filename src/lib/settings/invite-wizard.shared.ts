import type { SystemRoleName } from "@/lib/rbac/constants";
import { hybridLeadershipInviteRoleForRank } from "@/lib/native-alliance/invite-rank-exceptions.shared";

export type InviteWizardType = "invite_link" | "join_code" | "commander_claim";

export type InviteWizardStep = 1 | 2 | 3;

export type InviteLinkSubtype = "protected_link" | "email";

export type ClaimMode = "single" | "bulk";

export type InviteWizardTargets = {
  inviteLinkSubtype: InviteLinkSubtype;
  inviteEmail: string;
  inviteRole: SystemRoleName | "";
  inviteAdminLabel: string;
  inviteRedirectPath: string;
  /** Optional unclaimed commander to bind on an invite_link (hybrid officer+claim). */
  inviteLinkCommanderId: string;
  joinCodeRole: SystemRoleName;
  joinCodeMaxUses: string;
  joinCodeLabel: string;
  claimMode: ClaimMode;
  claimCommanderId: string;
  bulkSelectedIds: string[];
  claimAdminLabel: string;
};

export type InviteWizardWelcomeUrlState = {
  welcomeUrl: string;
  welcomeUrlRequiresAllianceTag: boolean;
};

export type InviteWizardResultInvite = {
  kind: "invite_link";
  inviteUrl: string;
  welcomeUrl: string;
  welcomeUrlRequiresAllianceTag: boolean;
  passphrase?: string;
  shareMessage: string;
};

export type InviteWizardResultJoinCode = InviteWizardWelcomeUrlState & {
  kind: "join_code";
  code: string;
  shareMessage: string;
};

export type InviteWizardResultClaimSingle = InviteWizardWelcomeUrlState & {
  kind: "claim_single";
  code: string;
  commanderName: string;
  shareMessage: string;
};

export type InviteWizardResultClaimBulk = {
  kind: "claim_bulk";
  items: Array<
    InviteWizardWelcomeUrlState & {
      ashedMemberId: string;
      name: string;
      code: string;
      shareMessage: string;
    }
  >;
  skippedCount: number;
};

export type InviteWizardResult =
  | InviteWizardResultInvite
  | InviteWizardResultJoinCode
  | InviteWizardResultClaimSingle
  | InviteWizardResultClaimBulk;

export const JOIN_CODE_DEFAULT_MAX_USES: Record<SystemRoleName, number> = {
  owner: 10,
  maintainer: 10,
  officer: 10,
  data_entry: 10,
  viewer: 10,
  member: 90,
};

export function defaultInviteWizardTargets(
  assignableRoles: SystemRoleName[],
): InviteWizardTargets {
  const defaultRole = assignableRoles.includes("member")
    ? "member"
    : (assignableRoles[0] ?? "member");

  return {
    inviteLinkSubtype: "protected_link",
    inviteEmail: "",
    inviteRole: defaultRole,
    inviteAdminLabel: "",
    inviteRedirectPath: "",
    inviteLinkCommanderId: "",
    joinCodeRole: defaultRole,
    joinCodeMaxUses: String(JOIN_CODE_DEFAULT_MAX_USES[defaultRole] ?? 10),
    joinCodeLabel: "",
    claimMode: "single",
    claimCommanderId: "",
    bulkSelectedIds: [],
    claimAdminLabel: "",
  };
}

export function isValidInviteEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Hybrid leadership+claim role from in-game rank (R4→officer, R5→owner). */
export function resolveOfficerHybridInviteRole(
  allianceRank: number | null | undefined,
): SystemRoleName | null {
  return hybridLeadershipInviteRoleForRank(allianceRank);
}
