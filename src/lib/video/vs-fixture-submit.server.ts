import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

type FixtureSubmitRow = {
  memberId: string;
  memberName: string;
  score: number;
  rank: number | null;
};

/**
 * Upsert VS scores into the local HQ ledger (hq_vs_scores) for a fixture
 * submit. Never writes to Ashed.
 */
export async function upsertLocalVsScores(params: {
  allianceId: string;
  recordedDate: string;
  rows: FixtureSubmitRow[];
}): Promise<{ upserted: number }> {
  const { allianceId, recordedDate, rows } = params;
  const db = getDb();
  let upserted = 0;

  for (const row of rows) {
    const id = nanoid(16);
    await db
      .insert(schema.hqVsScores)
      .values({
        id,
        allianceId,
        recordedDate,
        memberId: row.memberId,
        memberName: row.memberName,
        score: row.score,
        rank: row.rank,
        source: "fixture_submit",
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.hqVsScores.allianceId,
          schema.hqVsScores.recordedDate,
          schema.hqVsScores.memberId,
        ],
        set: {
          memberName: row.memberName,
          score: row.score,
          rank: row.rank,
          source: "fixture_submit",
          createdAt: new Date(),
        },
      });
    upserted++;
  }

  return { upserted };
}

/** Read local VS scores for an alliance + date (fixture ledger). */
export async function fetchLocalVsScores(
  allianceId: string,
  recordedDate: string,
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      memberId: schema.hqVsScores.memberId,
      score: schema.hqVsScores.score,
    })
    .from(schema.hqVsScores)
    .where(
      and(
        eq(schema.hqVsScores.allianceId, allianceId),
        eq(schema.hqVsScores.recordedDate, recordedDate),
      ),
    );

  const scores = new Map<string, number>();
  for (const row of rows) {
    scores.set(row.memberId, row.score);
  }
  return scores;
}
