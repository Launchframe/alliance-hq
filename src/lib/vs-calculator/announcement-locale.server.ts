import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { DiscordBotLocale } from "@/lib/discord/i18n";

type LocalePrefRow = {
  allianceRank: number | null;
  locale: string;
};

/**
 * Majority-vote locale from explicit `/language` preferences, preferring
 * alliance officers (R4+) over the full linked-member pool when officers have
 * set a preference. Ties and empty input resolve to `en-US`.
 */
export function pickMajorityLocale(rows: LocalePrefRow[]): DiscordBotLocale {
  const officerRows = rows.filter((row) => (row.allianceRank ?? 0) >= 4);
  const pool = officerRows.length > 0 ? officerRows : rows;
  if (pool.length === 0) return "en-US";

  const counts = new Map<DiscordBotLocale, number>();
  for (const row of pool) {
    const locale: DiscordBotLocale = row.locale === "pt-BR" ? "pt-BR" : "en-US";
    counts.set(locale, (counts.get(locale) ?? 0) + 1);
  }

  let winner: DiscordBotLocale = "en-US";
  let winnerCount = -1;
  for (const [locale, count] of counts) {
    if (count > winnerCount) {
      winner = locale;
      winnerCount = count;
    }
  }
  return winner;
}

/**
 * Resolves the locale for a VS daily announcement targeting `allianceId`.
 *
 * There is no guild-level locale column — Discord locale prefs are per-user
 * (`discord_user_prefs`, set via `/language`). We approximate a
 * guild-appropriate locale from the alliance's linked Discord members
 * (`discord_member_links`): majority preference among R4+ officers, falling
 * back to any linked member with an explicit preference, then `en-US` when
 * nobody has ever run `/language`.
 */
export async function resolveVsAnnouncementLocaleForAlliance(
  allianceId: string,
): Promise<DiscordBotLocale> {
  const db = getDb();
  const rows = await db
    .select({
      allianceRank: schema.allianceMembers.allianceRank,
      locale: schema.discordUserPrefs.locale,
    })
    .from(schema.discordMemberLinks)
    .innerJoin(
      schema.discordUserPrefs,
      eq(schema.discordMemberLinks.discordUserId, schema.discordUserPrefs.discordUserId),
    )
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.discordMemberLinks.allianceId),
        eq(schema.allianceMembers.ashedMemberId, schema.discordMemberLinks.ashedMemberId),
      ),
    )
    .where(eq(schema.discordMemberLinks.allianceId, allianceId));

  return pickMajorityLocale(rows);
}
