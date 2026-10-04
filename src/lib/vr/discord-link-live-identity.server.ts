import "server-only";

import {
  loadAllianceRosterMember,
  rebindFormerSeatToLive,
  resolveLiveSeatForFormerClaim,
} from "@/lib/members/uid-seat-handoff.server";
import { schema } from "@/lib/db";

type DiscordMemberLinkRow = typeof schema.discordMemberLinks.$inferSelect;

/**
 * Discord replies use HQ's current roster name, never the frozen link snapshot.
 */
export async function overlayDiscordMemberLinkName(
  link: DiscordMemberLinkRow,
): Promise<DiscordMemberLinkRow> {
  const member = await loadAllianceRosterMember(link.allianceId, link.ashedMemberId);
  if (!member?.currentName) return link;
  return { ...link, memberDisplayName: member.currentName };
}

/**
 * Discord replies use HQ's current roster name, never the frozen link snapshot.
 * If the linked Ashed seat is `former`, follow the stored Last War UID onto the
 * live roster row (rename / account hand-off) and retarget commander identity.
 */
export async function hydrateDiscordMemberLink(
  link: DiscordMemberLinkRow,
  options?: { rematerializeFormer?: boolean },
): Promise<DiscordMemberLinkRow> {
  const member = await loadAllianceRosterMember(link.allianceId, link.ashedMemberId);
  const next = member?.currentName
    ? { ...link, memberDisplayName: member.currentName }
    : link;

  if (member?.status === "active" || options?.rematerializeFormer === false) {
    return next;
  }

  try {
    const live = await resolveLiveSeatForFormerClaim({
      allianceId: next.allianceId,
      ashedMemberId: next.ashedMemberId,
      gameUid: next.gameUid,
      discordUserId: next.discordUserId,
    });
    if (!live) return next;
    const rebound = await rebindFormerSeatToLive({
      allianceId: next.allianceId,
      previousAshedMemberId: next.ashedMemberId,
      liveAshedMemberId: live.ashedMemberId,
      currentName: live.currentName,
      gameUid: next.gameUid,
      discordLink: next,
    });
    const discord = rebound.discordLink ?? next;
    return { ...discord, memberDisplayName: live.currentName };
  } catch {
    console.error("[discord-bot] live roster follow failed", {
      linkId: link.id,
      allianceId: link.allianceId,
    });
    return next;
  }
}

export async function hydrateDiscordMemberLinks(
  links: DiscordMemberLinkRow[],
  options?: { rematerializeFormer?: boolean },
): Promise<DiscordMemberLinkRow[]> {
  return Promise.all(
    links.map((row) => hydrateDiscordMemberLink(row, options)),
  );
}
