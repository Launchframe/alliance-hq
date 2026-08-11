import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

/** Member ids already drawn from today's Top VS / Top VR wheel (server calendar date). */
export async function listTopScoreSpinExcludedMemberIds(
  allianceId: string,
  date: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ memberId: schema.trainDayTopScoreSpinExclusions.memberId })
    .from(schema.trainDayTopScoreSpinExclusions)
    .where(
      and(
        eq(schema.trainDayTopScoreSpinExclusions.allianceId, allianceId),
        eq(schema.trainDayTopScoreSpinExclusions.date, date),
      ),
    );
  return rows.map((row) => row.memberId);
}

/** Record a drawn Top VS / Top VR winner for the rest of this calendar day. */
export async function recordTopScoreSpinExclusion(input: {
  allianceId: string;
  date: string;
  memberId: string;
  memberName: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.trainDayTopScoreSpinExclusions)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      date: input.date,
      memberId: input.memberId,
      memberName: input.memberName,
    })
    .onConflictDoNothing();
}
