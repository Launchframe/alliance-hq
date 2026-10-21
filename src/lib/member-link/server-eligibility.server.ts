import "server-only";

import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { isGameUidClaimedByOtherPrincipal } from "@/lib/member-link/game-uid-global-claim.server";
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
  let transferEligible = false;
  if (homeDiffers) {
    const gate = await isInviteGatedMemberLink({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      discordUserId: input.discordUserId,
    });
    // Invite/join-code alone is not enough: a different principal must not
    // confirm a "transfer" that rewrites another account's commander home.
    transferEligible =
      gate.gated &&
      !(await isGameUidClaimedByOtherPrincipal({
        gameUid: input.gameUid,
        hqUserId: input.hqUserId,
        discordUserId: input.discordUserId,
      }));
  }

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
