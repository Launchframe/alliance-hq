import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  listDiscordLinksForUser,
} from "@/lib/vr/repository";
import type { AshedMember } from "@/lib/video/member-matcher";

function memberAllianceRank(member: AshedMember): number {
  return parseAshedMemberAllianceRank(member).rank ?? 0;
}

export async function callerCanRunVrReport(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<boolean> {
  if (
    await callerIsAllianceOwner({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
    })
  ) {
    return true;
  }

  const [links, members] = await Promise.all([
    listDiscordLinksForUser(input.allianceId, input.discordUserId),
    loadAllianceMembersForBot(input.allianceId),
  ]);

  return links.some((link) => {
    const member = members.find((m) => m.id === link.ashedMemberId);
    return member != null && memberAllianceRank(member) >= 4;
  });
}
