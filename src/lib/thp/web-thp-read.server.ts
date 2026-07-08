import "server-only";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { parseThpBreakdownInput } from "@/lib/thp/breakdown.shared";
import type { MyThpPayload, ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { computeThpPercentileChange } from "@/lib/thp/percentile-change";
import { computeThpPercentile } from "@/lib/thp/percentile";
import {
  getCommanderIdForMember,
  getCommanderThpState,
  listAllianceCommanderThpEvents,
  listAllianceCommanderThpRows,
  listCommanderThpEvents,
} from "@/lib/thp/repository";

function mapBreakdown(value: unknown): ThpBreakdown | null {
  return parseThpBreakdownInput(value);
}

/** Read-only My THP payload — no OCR/sharp import graph. */
export async function loadMyThpForUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MyThpPayload | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) return null;

  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    link.ashedMemberId,
  );
  if (!commanderId) return null;

  const [commander, events, allianceRows, allianceEventsByCommander] =
    await Promise.all([
      getCommanderThpState(commanderId),
      listCommanderThpEvents(commanderId),
      listAllianceCommanderThpRows(input.allianceId),
      listAllianceCommanderThpEvents(input.allianceId),
    ]);

  const reporterThps = allianceRows
    .map((row) => row.total)
    .filter((total): total is number => total != null);
  const currentThp = commander?.currentTotalHeroPower ?? null;
  const percentile =
    currentThp != null ? computeThpPercentile(reporterThps, currentThp) : null;

  const viewerSnapshots = events.map((event) => ({
    commanderId,
    total: event.total,
    recordedAt: event.createdAt,
  }));
  const allianceSnapshots = new Map(
    [...allianceEventsByCommander.entries()].map(([id, rows]) => [
      id,
      rows.map((row) => ({
        commanderId: row.commanderId,
        total: row.total,
        recordedAt: row.createdAt,
      })),
    ]),
  );

  return {
    currentThp,
    breakdown: mapBreakdown(commander?.currentThpBreakdown),
    updatedAt: commander?.thpUpdatedAt?.toISOString() ?? null,
    commanderName: commander?.primaryName ?? link.memberDisplayName,
    percentile,
    percentileChange: computeThpPercentileChange({
      viewerCommanderId: commanderId,
      viewerEvents: viewerSnapshots,
      allianceEventsByCommander: allianceSnapshots,
    }),
    reporterCount: reporterThps.length,
    events: events.map((event) => ({
      total: event.total,
      breakdown: mapBreakdown(event.breakdown),
      previousTotal: event.previousTotal,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
    })),
  };
}
