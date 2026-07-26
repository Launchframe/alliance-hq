import "server-only";

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import {
  callerIsAllianceOwner,
  getAllianceById,
} from "@/lib/vr/repository";

/**
 * Discord-side gate for issuing commander claim invites.
 * Mirrors web `canManageInvitesAndOnboarding` using Discord officer/owner proofs.
 */
export async function callerCanIssueClaimInviteFromDiscord(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  const alliance = await getAllianceById(input.allianceId);
  if (!alliance) return false;

  if (alliance.inviteOnboardingMinRole === "owner") {
    return callerIsAllianceOwner(input);
  }

  return callerCanRunVrReport(input);
}
