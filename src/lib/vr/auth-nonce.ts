import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { DiscordAuthNoncePurpose } from "@/lib/vr/discord-guild-registration";

const NONCE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const DISCORD_USER_LINK_TAG = "_user_link";

/** Creates a new one-time nonce for the /discord/authorize HQ redirect flow. */
export async function createDiscordAuthNonce(input: {
  discordUserId: string;
  guildId: string | null;
  tag?: string;
  purpose?: DiscordAuthNoncePurpose;
}): Promise<string> {
  const db = getDb();
  const nonce = randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  const purpose = input.purpose ?? "alliance_credentials";
  const tag =
    purpose === "user_link"
      ? DISCORD_USER_LINK_TAG
      : input.tag?.trim().toLowerCase() ?? "";

  if (purpose === "alliance_credentials" && !tag) {
    throw new Error("Alliance credential nonces require a tag.");
  }

  await db.insert(schema.discordAuthNonces).values({
    id: nanoid(),
    nonce,
    discordUserId: input.discordUserId,
    guildId: input.guildId ?? null,
    tag,
    purpose,
    expiresAt,
    createdAt: now,
  });

  return nonce;
}

/** Returns the nonce row only if it exists, is unexpired, and has not been used. */
export async function getValidDiscordAuthNonce(nonce: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordAuthNonces)
    .where(
      and(
        eq(schema.discordAuthNonces.nonce, nonce),
        gt(schema.discordAuthNonces.expiresAt, new Date()),
        isNull(schema.discordAuthNonces.usedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Marks a nonce as consumed so it cannot be replayed. */
export async function consumeDiscordAuthNonce(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordAuthNonces)
    .set({ usedAt: new Date() })
    .where(eq(schema.discordAuthNonces.id, id));
}
