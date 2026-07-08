import {
  buildClaimCodeShareMessage,
  buildInviteLinkShareMessage,
  buildJoinCodeShareMessage,
} from "@/lib/settings/invite-share-message.shared";
import type {
  InviteWizardResult,
  InviteWizardTargets,
  InviteWizardType,
} from "@/lib/settings/invite-wizard.shared";
import { isValidInviteEmail } from "@/lib/settings/invite-wizard.shared";

type CommanderRow = { ashedMemberId: string; name: string };

export async function generateInviteWizardResult(input: {
  type: InviteWizardType;
  targets: InviteWizardTargets;
  allianceName: string;
  commanders: CommanderRow[];
}): Promise<InviteWizardResult> {
  const { type, targets, allianceName, commanders } = input;

  if (type === "invite_link") {
    const res = await fetch("/api/settings/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: targets.inviteLinkSubtype,
        email:
          targets.inviteLinkSubtype === "email"
            ? targets.inviteEmail.trim()
            : undefined,
        roleName: targets.inviteRole,
        redirectPath: targets.inviteRedirectPath.trim() || undefined,
        adminLabel: targets.inviteAdminLabel.trim() || undefined,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      invite?: { inviteUrl: string; passphrase?: string };
    };
    if (!res.ok) {
      throw new Error(body.error ?? "Could not create invite.");
    }
    const inviteUrl = body.invite?.inviteUrl ?? "";
    const passphrase = body.invite?.passphrase;
    return {
      kind: "invite_link",
      inviteUrl,
      passphrase,
      shareMessage: buildInviteLinkShareMessage({
        allianceName,
        inviteUrl,
        passphrase,
      }),
    };
  }

  if (type === "join_code") {
    const maxRedemptions = Number.parseInt(targets.joinCodeMaxUses, 10);
    const res = await fetch("/api/settings/team/join-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleName: targets.joinCodeRole,
        maxRedemptions,
        adminLabel: targets.joinCodeLabel.trim() || undefined,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      joinCode?: { code: string };
    };
    if (!res.ok) {
      throw new Error(body.error ?? "Could not create join code.");
    }
    const code = body.joinCode?.code ?? "";
    return {
      kind: "join_code",
      code,
      shareMessage: buildJoinCodeShareMessage({ allianceName, joinCode: code }),
    };
  }

  if (targets.claimMode === "bulk") {
    const res = await fetch("/api/settings/team/invites/bulk-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetAshedMemberIds: targets.bulkSelectedIds,
        adminLabel: targets.claimAdminLabel.trim() || undefined,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      created?: Array<{
        targetAshedMemberId?: string | null;
        targetCommanderName?: string | null;
        code: string;
      }>;
      skipped?: Array<{ ashedMemberId: string }>;
    };
    if (!res.ok) {
      throw new Error(body.error ?? "Could not create claim codes.");
    }
    const created = body.created ?? [];
    const skipped = body.skipped ?? [];
    return {
      kind: "claim_bulk",
      skippedCount: skipped.length,
      items: created.map((row) => {
        const ashedMemberId = row.targetAshedMemberId ?? "";
        const name =
          row.targetCommanderName ??
          commanders.find((c) => c.ashedMemberId === ashedMemberId)?.name ??
          "";
        const code = row.code;
        return {
          ashedMemberId,
          name,
          code,
          shareMessage: buildClaimCodeShareMessage({
            allianceName,
            joinCode: code,
          }),
        };
      }),
    };
  }

  const selected = commanders.find(
    (c) => c.ashedMemberId === targets.claimCommanderId,
  );
  const res = await fetch("/api/settings/team/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "protected_link",
      roleName: "member",
      targetAshedMemberId: targets.claimCommanderId,
      adminLabel: targets.claimAdminLabel.trim() || undefined,
    }),
  });
  const body = (await res.json()) as {
    error?: string;
    code?: string;
    joinCode?: { code: string; targetCommanderName?: string | null };
  };
  if (!res.ok) {
    if (body.code === "commander_already_claimed") {
      throw new Error("COMMANDER_ALREADY_CLAIMED");
    }
    throw new Error(body.error ?? "Could not create claim code.");
  }
  const code = body.joinCode?.code ?? "";
  const commanderName =
    body.joinCode?.targetCommanderName ?? selected?.name ?? "";
  return {
    kind: "claim_single",
    code,
    commanderName,
    shareMessage: buildClaimCodeShareMessage({ allianceName, joinCode: code }),
  };
}

export function validateInviteWizardStep2(input: {
  type: InviteWizardType;
  targets: InviteWizardTargets;
}): string | null {
  const { type, targets } = input;

  if (type === "invite_link") {
    if (targets.inviteRole === "") {
      return "inviteRoleRequired";
    }
    if (
      targets.inviteLinkSubtype === "email" &&
      !isValidInviteEmail(targets.inviteEmail)
    ) {
      return "inviteEmailRequired";
    }
    return null;
  }

  if (type === "join_code") {
    const max = Number.parseInt(targets.joinCodeMaxUses, 10);
    if (!Number.isFinite(max) || max < 1 || max > 500) {
      return "joinCodeMaxUsesInvalid";
    }
    return null;
  }

  if (targets.claimMode === "bulk") {
    if (targets.bulkSelectedIds.length === 0) {
      return "claimCommanderRequired";
    }
    return null;
  }

  if (!targets.claimCommanderId) {
    return "claimCommanderRequired";
  }
  return null;
}
