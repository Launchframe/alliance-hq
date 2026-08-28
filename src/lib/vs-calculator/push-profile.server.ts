import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { HeroDayPushProfilePayload } from "@/lib/vs-calculator/planner/planner-types.shared";
import {
  emptyHeroDayPushProfile,
  sanitizeHeroDayPushProfile,
} from "@/lib/vs-calculator/planner/push-profile.shared";

export async function getCommanderVsPushProfile(
  commanderId: string,
): Promise<HeroDayPushProfilePayload> {
  const db = getDb();
  const [row] = await db
    .select({ payload: schema.commanderVsPushProfiles.payload })
    .from(schema.commanderVsPushProfiles)
    .where(eq(schema.commanderVsPushProfiles.commanderId, commanderId))
    .limit(1);
  if (!row?.payload) return emptyHeroDayPushProfile();
  return sanitizeHeroDayPushProfile(row.payload);
}

export async function putCommanderVsPushProfile(input: {
  commanderId: string;
  payload: HeroDayPushProfilePayload;
  hqUserId: string;
}): Promise<HeroDayPushProfilePayload> {
  const sanitized = sanitizeHeroDayPushProfile(input.payload);
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.commanderVsPushProfiles)
    .values({
      commanderId: input.commanderId,
      payload: sanitized,
      reportedByHqUserId: input.hqUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.commanderVsPushProfiles.commanderId,
      set: {
        payload: sanitized,
        reportedByHqUserId: input.hqUserId,
        updatedAt: now,
      },
    });

  return sanitized;
}
