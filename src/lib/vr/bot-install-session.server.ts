import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

const SESSION_TTL_MS = 30 * 60 * 1000;

export async function createDiscordBotInstallSession(input: {
  hqUserId: string;
  discordUserId: string;
  allianceTag: string;
  allianceId?: string | null;
}): Promise<string> {
  const db = getDb();
  const nonce = randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.insert(schema.discordBotInstallSessions).values({
    id: nanoid(),
    nonce,
    hqUserId: input.hqUserId.trim(),
    discordUserId: input.discordUserId.trim(),
    allianceTag: input.allianceTag.trim().toLowerCase(),
    allianceId: input.allianceId?.trim() || null,
    expiresAt,
    createdAt: now,
  });

  return nonce;
}

export async function getValidDiscordBotInstallSession(nonce: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordBotInstallSessions)
    .where(
      and(
        eq(schema.discordBotInstallSessions.nonce, nonce),
        gt(schema.discordBotInstallSessions.expiresAt, new Date()),
        isNull(schema.discordBotInstallSessions.usedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateDiscordBotInstallSessionAllianceByNonce(input: {
  nonce: string;
  allianceId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordBotInstallSessions)
    .set({ allianceId: input.allianceId.trim() })
    .where(eq(schema.discordBotInstallSessions.nonce, input.nonce.trim()));
}

export async function consumeDiscordBotInstallSession(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discordBotInstallSessions)
    .set({ usedAt: new Date() })
    .where(eq(schema.discordBotInstallSessions.id, id));
}
