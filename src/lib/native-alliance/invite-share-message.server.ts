import "server-only";

import {
  buildClaimCodeShareMessage,
  buildInviteLinkShareMessage,
  buildJoinCodeShareMessage,
} from "@/lib/settings/invite-share-message.shared";

export type InviteShareVariant = "invite_link" | "join_code" | "claim_code";

export function buildInviteShareMessage(input: {
  variant: InviteShareVariant;
  allianceName: string;
  welcomeUrl: string | null;
  joinCode?: string;
  passphrase?: string | null;
}): string {
  const allianceName = input.allianceName.trim() || "your alliance";
  const welcomeUrl = input.welcomeUrl?.trim() || undefined;

  if (input.variant === "invite_link") {
    return buildInviteLinkShareMessage({
      allianceName,
      inviteUrl: welcomeUrl,
      passphrase: input.passphrase ?? undefined,
    });
  }

  if (input.variant === "join_code") {
    return buildJoinCodeShareMessage({
      allianceName,
      welcomeUrl,
      joinCode: input.joinCode,
    });
  }

  return buildClaimCodeShareMessage({
    allianceName,
    welcomeUrl,
    joinCode: input.joinCode,
  });
}
