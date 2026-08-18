import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

export async function createOfficerIntelThread(input: {
  allianceId: string;
  hqUserId: string | null;
}) {
  const db = getDb();
  const id = nanoid();
  const now = new Date();
  await db.insert(schema.officerIntelThreads).values({
    id,
    allianceId: input.allianceId,
    createdByHqUserId: input.hqUserId,
    runningSummary: null,
    turnCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getOfficerIntelThreadForAlliance(input: {
  threadId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerIntelThreads)
    .where(
      and(
        eq(schema.officerIntelThreads.id, input.threadId),
        eq(schema.officerIntelThreads.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function appendOfficerIntelThreadMessage(input: {
  threadId: string;
  allianceId: string;
  role: "user" | "assistant";
  content: string;
  citations?: unknown;
}) {
  const db = getDb();
  const thread = await getOfficerIntelThreadForAlliance({
    threadId: input.threadId,
    allianceId: input.allianceId,
  });
  if (!thread) {
    return { error: "not_found" as const };
  }

  const id = nanoid();
  const now = new Date();
  await db.insert(schema.officerIntelThreadMessages).values({
    id,
    threadId: input.threadId,
    allianceId: input.allianceId,
    role: input.role,
    content: input.content,
    citationsJson: input.citations ?? null,
    createdAt: now,
  });
  await db
    .update(schema.officerIntelThreads)
    .set({ updatedAt: now })
    .where(eq(schema.officerIntelThreads.id, input.threadId));

  return { ok: true as const, messageId: id };
}

export async function updateOfficerIntelThreadSummary(input: {
  threadId: string;
  allianceId: string;
  runningSummary: string | null;
  turnCount: number;
}) {
  const db = getDb();
  const thread = await getOfficerIntelThreadForAlliance({
    threadId: input.threadId,
    allianceId: input.allianceId,
  });
  if (!thread) {
    return { error: "not_found" as const };
  }

  const now = new Date();
  await db
    .update(schema.officerIntelThreads)
    .set({
      runningSummary: input.runningSummary,
      turnCount: input.turnCount,
      updatedAt: now,
    })
    .where(eq(schema.officerIntelThreads.id, input.threadId));

  return { ok: true as const };
}

export async function listOfficerIntelThreadMessages(input: {
  threadId: string;
  allianceId: string;
  limit?: number;
}) {
  const db = getDb();
  const thread = await getOfficerIntelThreadForAlliance({
    threadId: input.threadId,
    allianceId: input.allianceId,
  });
  if (!thread) return [];

  const query = db
    .select()
    .from(schema.officerIntelThreadMessages)
    .where(
      and(
        eq(schema.officerIntelThreadMessages.threadId, input.threadId),
        eq(schema.officerIntelThreadMessages.allianceId, input.allianceId),
      ),
    )
    .orderBy(asc(schema.officerIntelThreadMessages.createdAt));

  const rows = input.limit ? await query.limit(input.limit) : await query;
  return rows;
}
