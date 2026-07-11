import "server-only";

import { and, eq, ne } from "drizzle-orm";

import type { ParsedConnection } from "@/lib/connectionString";
import { base44Json } from "@/lib/base44/fetch";
import { getDb, schema } from "@/lib/db";
import {
  ashedStormScoresOverlapTeam,
  type StormTeam,
} from "@/lib/video/storm-score-overlap.shared";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";

export type StormScoreOverlapResult = {
  overlaps: boolean;
  source: "ashed" | "hq" | null;
};

/**
 * Detect prior Desert/Canyon Storm scores for the same alliance + event type +
 * team + recorded date (Ashed first, then completed HQ video jobs).
 */
export async function findStormScoreOverlap(params: {
  connection: ParsedConnection | null;
  allianceId: string;
  scoreTargetId: string;
  eventId: string | null;
  team: StormTeam;
  recordedDate: string;
  excludeJobId?: string;
}): Promise<StormScoreOverlapResult> {
  const target = getScoreTargetOrThrow(params.scoreTargetId);
  if (!target.submitContext.includes("team")) {
    return { overlaps: false, source: null };
  }

  if (params.connection && params.eventId) {
    try {
      const q = encodeURIComponent(
        JSON.stringify({
          alliance_id: params.allianceId,
          event_id: params.eventId,
        }),
      );
      const rows = await base44Json<
        Array<{ team?: string | null; recorded_date?: string | null }>
      >(params.connection, `/entities/${target.submitEntity}?q=${q}`);
      const list = Array.isArray(rows) ? rows : [];
      if (
        ashedStormScoresOverlapTeam({
          rows: list,
          team: params.team,
          recordedDate: params.recordedDate,
        })
      ) {
        return { overlaps: true, source: "ashed" };
      }
      // Ashed is scoped by event_id; HQ jobs do not store it yet.
      return { overlaps: false, source: null };
    } catch {
      // Fall through to HQ job history when Ashed is unreachable.
    }
  }

  const db = getDb();
  const filters = [
    eq(schema.videoJobs.allianceId, params.allianceId),
    eq(schema.videoJobs.scoreTarget, params.scoreTargetId),
    eq(schema.videoJobs.team, params.team),
    eq(schema.videoJobs.recordedDate, params.recordedDate),
    eq(schema.videoJobs.status, "complete"),
  ];
  if (params.excludeJobId) {
    filters.push(ne(schema.videoJobs.id, params.excludeJobId));
  }

  const [existing] = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(and(...filters))
    .limit(1);

  if (existing) {
    return { overlaps: true, source: "hq" };
  }

  return { overlaps: false, source: null };
}
