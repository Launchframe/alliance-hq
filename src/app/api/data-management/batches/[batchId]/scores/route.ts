import { NextResponse } from "next/server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { base44Json } from "@/lib/base44/fetch";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import { getAllianceDataBatch } from "@/lib/data-management/batch-ledger.server";
import { getAshedConnection } from "@/lib/session";

type Props = {
  params: Promise<{ batchId: string }>;
};

/**
 * GET /api/data-management/batches/[batchId]/scores
 * Lists Ashed score rows for a ledger batch (event + team + date scoped).
 */
export async function GET(_request: Request, { params }: Props) {
  try {
    const { batchId } = await params;
    const ctx = await resolveDataManagementApiContext();
    if (ctx instanceof NextResponse) return ctx;

    const batch = await getAllianceDataBatch({
      allianceId: ctx.allianceId,
      batchId,
    });
    if (!batch || batch.status !== "active") {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    const connection = await getAshedConnection(ctx.sessionId);
    if (!connection) {
      return NextResponse.json(
        { error: "Ashed not connected", code: "ashed_not_connected" },
        { status: 503 },
      );
    }

    const ashedAllianceId = await getAshedAllianceIdIfLinked(ctx.allianceId);
    if (!ashedAllianceId) {
      return NextResponse.json(
        { error: "Alliance is not linked to Ashed." },
        { status: 409 },
      );
    }

    const q: Record<string, string> = {
      alliance_id: ashedAllianceId,
    };
    if (batch.contextJson.eventId) {
      q.event_id = batch.contextJson.eventId;
    }

    const rows = await base44Json<
      Array<{
        id?: string;
        member_id?: string;
        member_name?: string | null;
        score?: number | string | null;
        rank?: number | null;
        team?: string | null;
        recorded_date?: string | null;
        event_id?: string | null;
      }>
    >(
      connection,
      `/entities/${batch.submitEntity}?q=${encodeURIComponent(JSON.stringify(q))}`,
    );

    const list = Array.isArray(rows) ? rows : [];
    const team = batch.contextJson.team;
    const filtered = list.filter((row) => {
      if (
        batch.recordedDate &&
        row.recorded_date &&
        row.recorded_date.slice(0, 10) !== batch.recordedDate
      ) {
        return false;
      }
      if (team === "A" || team === "B") {
        return row.team === team;
      }
      return true;
    });

    return NextResponse.json({
      scores: filtered.map((row) => ({
        id: row.id ?? null,
        memberId: row.member_id ?? null,
        memberName: row.member_name ?? null,
        score: row.score ?? null,
        rank: row.rank ?? null,
        team: row.team ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load scores",
      },
      { status: 500 },
    );
  }
}
