import "server-only";

import type { MyKillsPayload } from "@/lib/kills/my-kills.shared";
import { computeKillsPercentileChange } from "@/lib/kills/percentile-change";
import { computeKillsPercentile } from "@/lib/kills/percentile";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import {
  getCommanderIdForMember,
  getCommanderKillsState,
  listAllianceCommanderKillsEvents,
  listAllianceCommanderKillsRows,
  listCommanderKillsEvents,
} from "@/lib/kills/repository";

/** Read-only My Kills payload. */
export async function loadMyKillsForUser(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MyKillsPayload | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) return null;

  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    link.ashedMemberId,
  );
  if (!commanderId) return null;

  const [commander, events, allianceRows, allianceEventsByCommander] =
    await Promise.all([
      getCommanderKillsState(commanderId),
      listCommanderKillsEvents(commanderId),
      listAllianceCommanderKillsRows(input.allianceId),
      listAllianceCommanderKillsEvents(input.allianceId),
    ]);

  const reporterKills = allianceRows
    .map((row) => row.total)
    .filter((total): total is number => total != null);
  const currentKills = commander?.currentKills ?? null;
  const percentile =
    currentKills != null
      ? computeKillsPercentile(reporterKills, currentKills)
      : null;

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
    currentKills,
    updatedAt: commander?.killsUpdatedAt?.toISOString() ?? null,
    commanderName: commander?.primaryName ?? link.memberDisplayName,
    percentile,
    percentileChange: computeKillsPercentileChange({
      viewerCommanderId: commanderId,
      viewerEvents: viewerSnapshots,
      allianceEventsByCommander: allianceSnapshots,
    }),
    reporterCount: reporterKills.length,
    events: events.map((event) => ({
      total: event.total,
      previousTotal: event.previousTotal,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
    })),
  };
}
