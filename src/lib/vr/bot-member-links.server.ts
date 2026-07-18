import "server-only";

import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import { listDiscordLinksForUser } from "@/lib/vr/repository";

/**
 * Discord member links for status/chart queries, with lazy HQ→Discord inherit
 * when the user has no links yet in this alliance.
 */
export async function listDiscordLinksForStatusQuery(
  allianceId: string,
  discordUserId: string,
) {
  let links = await listDiscordLinksForUser(allianceId, discordUserId);
  if (links.length === 0) {
    await ensureDiscordMemberLinksFromHq({ discordUserId, allianceId });
    links = await listDiscordLinksForUser(allianceId, discordUserId);
  }
  return links;
}
