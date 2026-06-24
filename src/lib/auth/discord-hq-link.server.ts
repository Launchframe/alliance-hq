import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { upsertDiscordHqLink } from "@/lib/vr/repository";

/** Web Discord OAuth — same identity the VR bot uses (`discord_hq_links`). */
export async function syncDiscordHqLinkFromOAuthSignIn(input: {
  discordUserId: string;
  hqUserId: string;
}): Promise<void> {
  const discordUserId = input.discordUserId.trim();
  const hqUserId = input.hqUserId.trim();
  if (!discordUserId || !hqUserId) {
    return;
  }

  const db = getDb();
  await db
    .delete(schema.discordHqLinks)
    .where(
      and(
        eq(schema.discordHqLinks.hqUserId, hqUserId),
        ne(schema.discordHqLinks.discordUserId, discordUserId),
      ),
    );

  await upsertDiscordHqLink({ discordUserId, hqUserId });
}
