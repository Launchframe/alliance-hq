import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

/** Member ids already drawn from today's non-deterministic conductor spin. */
export async function listDaySpinExcludedMemberIds(
  allianceId: string,
  date: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ memberId: schema.trainDaySpinExclusions.memberId })
    .from(schema.trainDaySpinExclusions)
    .where(
      and(
        eq(schema.trainDaySpinExclusions.allianceId, allianceId),
        eq(schema.trainDaySpinExclusions.date, date),
      ),
    );
  return rows.map((row) => row.memberId);
}

/** Record a drawn winner for the rest of this calendar day (server date). */
export async function recordDaySpinExclusion(input: {
  allianceId: string;
  date: string;
  memberId: string;
  memberName: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.trainDaySpinExclusions)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      date: input.date,
      memberId: input.memberId,
      memberName: input.memberName,
    })
    .onConflictDoNothing();
}
