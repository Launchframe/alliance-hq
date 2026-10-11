import "server-only";

import { writeAuditLog } from "@/lib/bff/audit";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { isInviteGatedMemberLink } from "@/lib/member-link/invite-gate.server";
import { resolveCommanderByUid } from "@/lib/members/commander-identity.server";

import {
  resolveMemberLinkServerEligibility,
  type ServerEligibilityResult,
} from "./server-eligibility.shared";

export type ResolvedMemberLinkServerEligibility = ServerEligibilityResult & {
  allianceServer: number | null;
  knownCommanderHomeServer: number | null;
};

export async function resolveMemberLinkServerEligibilityForUid(input: {
  allianceId: string;
  gameUid: string;
  lookupServer: number | null | undefined;
  allianceHomeConfirmed?: boolean;
  userClaimedLookupAsHome?: boolean;
  /** Caller identity — used to check invite / join-code gating for transfers. */
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<ResolvedMemberLinkServerEligibility> {
  const [allianceServer, commander] = await Promise.all([
    resolveAllianceGameServerNumber(input.allianceId),
    resolveCommanderByUid(input.gameUid),
  ]);
  const knownCommanderHomeServer = commander?.gameServerNumber ?? null;

  const homeDiffers =
    allianceServer != null &&
    knownCommanderHomeServer != null &&
    knownCommanderHomeServer !== allianceServer;
  const transferEligible = homeDiffers
    ? (
        await isInviteGatedMemberLink({
          allianceId: input.allianceId,
          hqUserId: input.hqUserId,
          discordUserId: input.discordUserId,
        })
      ).gated
    : false;

  const result = resolveMemberLinkServerEligibility({
    lookupServer: input.lookupServer,
    allianceServer,
    knownCommanderHomeServer,
    allianceHomeConfirmed: input.allianceHomeConfirmed,
    userClaimedLookupAsHome: input.userClaimedLookupAsHome,
    transferEligible,
  });

  if (
    result.kind === "eligible" &&
    result.reason === "user_confirmed_server_transfer" &&
    commander
  ) {
    await writeAuditLog({
      sessionId: null,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId ?? null,
      action: "member_link.server_transfer_confirmed",
      resourceType: "commander",
      resourceName: commander.primaryName,
      resourceId: commander.id,
      metadata: {
        fromServer: knownCommanderHomeServer,
        toServer: allianceServer,
        origin: input.discordUserId ? "discord" : "web",
      },
      severity: "update",
    });
  }

  return {
    ...result,
    allianceServer,
    knownCommanderHomeServer,
  } as ResolvedMemberLinkServerEligibility;
}
