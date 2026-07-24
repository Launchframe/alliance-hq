import "server-only";

import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
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
}): Promise<ResolvedMemberLinkServerEligibility> {
  const [allianceServer, commander] = await Promise.all([
    resolveAllianceGameServerNumber(input.allianceId),
    resolveCommanderByUid(input.gameUid),
  ]);
  const knownCommanderHomeServer = commander?.gameServerNumber ?? null;
  const result = resolveMemberLinkServerEligibility({
    lookupServer: input.lookupServer,
    allianceServer,
    knownCommanderHomeServer,
    allianceHomeConfirmed: input.allianceHomeConfirmed,
    userClaimedLookupAsHome: input.userClaimedLookupAsHome,
  });
  return {
    ...result,
    allianceServer,
    knownCommanderHomeServer,
  } as ResolvedMemberLinkServerEligibility;
}
