import "server-only";

import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import type { TimeOffActor } from "./mutations.server";
import type { TimeOffDiscordState } from "./discord-workflow.shared";
import { TimeOffError } from "./workflow.shared";

export type TimeOffDiscordActor = TimeOffActor & { guildId: string; discordUserId: string };

export async function saveTimeOffInteraction(actor: TimeOffDiscordActor, state: TimeOffDiscordState) {
  const id = nanoid();
  await getDb().insert(schema.timeOffDiscordInteractions).values({
    id,
    allianceId: actor.allianceId,
    guildId: actor.guildId,
    discordUserId: actor.discordUserId,
    state,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return id;
}

export async function loadTimeOffInteraction(actor: TimeOffDiscordActor, token: string): Promise<TimeOffDiscordState> {
  const [row] = await getDb().select({ state: schema.timeOffDiscordInteractions.state })
    .from(schema.timeOffDiscordInteractions)
    .where(and(
      eq(schema.timeOffDiscordInteractions.id, token),
      eq(schema.timeOffDiscordInteractions.allianceId, actor.allianceId),
      eq(schema.timeOffDiscordInteractions.guildId, actor.guildId),
      eq(schema.timeOffDiscordInteractions.discordUserId, actor.discordUserId),
      gt(schema.timeOffDiscordInteractions.expiresAt, new Date()),
    )).limit(1);
  if (!row?.state || typeof row.state !== "object" || !("kind" in row.state)) throw new TimeOffError("expired", 403);
  return row.state as TimeOffDiscordState;
}
