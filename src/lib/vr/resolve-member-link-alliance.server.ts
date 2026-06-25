import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { lookupPlayerByUid, parseGameServerNumberFromUid } from "@/lib/lastwar/player-lookup";
import { findExactMemberByName, namesMatch } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getGuildAllianceId,
  resolveOwnerSetupAllianceId,
} from "@/lib/vr/repository";

/**
 * Resolve alliance tenant for Discord member link when the guild is not yet
 * registered. Registered guilds use `discord_guild_alliances`; cold-start uses
 * credential setup or a single native alliance match on server + roster.
 */
export async function resolveAllianceIdForDiscordMemberLink(input: {
  guildId: string;
  discordUserId: string;
  reportedName?: string;
  gameUid?: string;
}): Promise<string | null> {
  const registered = await getGuildAllianceId(input.guildId);
  if (registered) return registered;

  const fromOwnerSetup = await resolveOwnerSetupAllianceId(
    input.guildId,
    input.discordUserId,
  );
  if (fromOwnerSetup) return fromOwnerSetup;

  const name = input.reportedName?.trim();
  const uid = input.gameUid?.trim();
  if (!name || !uid) return null;

  const serverNumber = parseGameServerNumberFromUid(uid);
  if (serverNumber == null) return null;

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok || !namesMatch(name, lookup.gameUserName)) return null;

  const db = getDb();
  const candidates = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(
      and(
        eq(schema.alliances.gameServerNumber, serverNumber),
        eq(schema.alliances.operatingMode, "native"),
      ),
    );

  const matches: string[] = [];
  for (const candidate of candidates) {
    const members = await loadAllianceMembersForBot(candidate.id);
    const exact = findExactMemberByName(members, lookup.gameUserName);
    if (exact) matches.push(candidate.id);
  }

  return matches.length === 1 ? matches[0]! : null;
}
