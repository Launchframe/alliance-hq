import "server-only";

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

  return {
    ...result,
    allianceServer,
    knownCommanderHomeServer,
  } as ResolvedMemberLinkServerEligibility;
}
