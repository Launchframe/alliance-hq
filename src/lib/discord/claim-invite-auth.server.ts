import "server-only";

import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import {
  callerIsAllianceOwner,
  callerIsPlatformMaintainerViaDiscord,
  getAllianceById,
} from "@/lib/vr/repository";

/**
 * Discord-side gate for issuing commander claim invites.
 * Mirrors web `canManageInvitesAndOnboarding`: platform maintainers (via
 * Discord↔HQ link), then owner-only or officer proofs per alliance setting.
 */
export async function callerCanIssueClaimInviteFromDiscord(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  if (await callerIsPlatformMaintainerViaDiscord(input.discordUserId)) {
    return true;
  }

  const alliance = await getAllianceById(input.allianceId);
  if (!alliance) return false;

  if (alliance.inviteOnboardingMinRole === "owner") {
    return callerIsAllianceOwner(input);
  }

  return callerCanRunVrReport(input);
}
