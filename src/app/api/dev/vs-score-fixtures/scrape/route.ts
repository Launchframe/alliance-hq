import { NextResponse, type NextRequest } from "next/server";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-alliance";
import { base44Json } from "@/lib/base44/fetch";
import { normalizeAshedVsRows } from "@/lib/video/vs-fixture-normalize";
import { addCalendarDays } from "@/lib/trains/game-time";
import type { VsScoreDayTemplate, VsScoreFixtureRow } from "@/lib/video/vs-fixture-types";

export const dynamic = "force-dynamic";

type AshedVsScoreRow = {
  id?: string;
  member_id?: string;
  memberId?: string;
  member_name?: string;
  memberName?: string;
  current_name?: string;
  score?: number;
  points?: number;
  total?: number;
  rank?: number;
  recorded_date?: string;
};

async function fetchVsDay(
  connection: import("@/lib/connectionString").ParsedConnection,
  allianceId: string,
  date: string,
): Promise<AshedVsScoreRow[]> {
  const path = `/entities/VSScore?q=${encodeURIComponent(
    JSON.stringify({
      alliance_id: allianceId,
      recorded_date: date,
    }),
  )}&sort=-score`;
  return base44Json<AshedVsScoreRow[]>(connection, path);
}

/**
 * GET /api/dev/vs-score-fixtures/scrape?date=YYYY-MM-DD
 *   → scrape one day
 * GET /api/dev/vs-score-fixtures/scrape?weekStart=YYYY-MM-DD
 *   → scrape Mon–Sat (6 days)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const session = await getOrCreateSession();
  const connection = await getAshedConnection(session.id);
  if (!connection) {
    return NextResponse.json(
      { error: "Ashed not connected. Connect via Settings first." },
      { status: 503 },
    );
  }

  const ashedAllianceId = await resolveSessionAllianceId(
    session.id,
    connection,
  );

  const { searchParams } = request.nextUrl;
  const singleDate = searchParams.get("date");
  const weekStart = searchParams.get("weekStart");

  if (singleDate) {
    const rawRows = await fetchVsDay(connection, ashedAllianceId, singleDate);
    const rows = normalizeAshedVsRows(rawRows);

    const template: VsScoreDayTemplate = {
      id: `scraped-${singleDate}`,
      name: `Scraped ${singleDate}`,
      tags: [],
      kind: "day",
      sourceRecordedDate: singleDate,
      scrapedAt: new Date().toISOString(),
      rows,
    };

    return NextResponse.json(template);
  }

  if (weekStart) {
    const days: Array<{
      sourceRecordedDate: string;
      rows: VsScoreFixtureRow[];
    }> = [];
    for (let i = 0; i < 6; i++) {
      const date = addCalendarDays(weekStart, i);
      const rawRows = await fetchVsDay(connection, ashedAllianceId, date);
      days.push({
        sourceRecordedDate: date,
        rows: normalizeAshedVsRows(rawRows),
      });
    }

    return NextResponse.json({
      id: `scraped-week-${weekStart}`,
      name: `Scraped week ${weekStart}`,
      tags: [],
      kind: "week",
      sourceWeekStart: weekStart,
      scrapedAt: new Date().toISOString(),
      days,
    });
  }

  return NextResponse.json(
    { error: "Provide ?date= or ?weekStart= query parameter." },
    { status: 400 },
  );
}
