import "server-only";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { addCalendarDays } from "@/lib/trains/game-time";

type AshedDonationRow = {
  member_id?: string;
  memberId?: string;
  id?: string;
  score?: number;
  points?: number;
  total?: number;
  recorded_date?: string;
};

function memberIdFromRow(row: AshedDonationRow): string | null {
  const memberId = row.member_id ?? row.memberId ?? row.id;
  return memberId ? String(memberId) : null;
}

function scoreValue(row: AshedDonationRow): number {
  return Number(row.score ?? row.points ?? row.total ?? 0);
}

async function fetchDonationRowsForRecordedDate(
  connection: ParsedConnection,
  allianceId: string,
  recordedDate: string,
): Promise<AshedDonationRow[]> {
  const path = `/entities/Donation?q=${encodeURIComponent(
    JSON.stringify({
      alliance_id: allianceId,
      recorded_date: recordedDate,
    }),
  )}`;
  return base44Json<AshedDonationRow[]>(connection, path);
}

export async function fetchDonationTotalsForDateRange(
  connection: ParsedConnection,
  allianceId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let cursor = startDate;

  while (cursor <= endDate) {
    const rows = await fetchDonationRowsForRecordedDate(
      connection,
      allianceId,
      cursor,
    );
    for (const row of rows) {
      const memberId = memberIdFromRow(row);
      if (!memberId) continue;
      totals.set(memberId, (totals.get(memberId) ?? 0) + scoreValue(row));
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return totals;
}
