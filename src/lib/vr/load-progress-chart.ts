import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getCommanderByAshedMemberId,
  listAllianceSeasonVrForLeaderboard,
  listCommanderSeasonVrEventsBulk,
  listDiscordLinksByAlliance,
  resolveVrSeasonContext,
} from "@/lib/vr/repository";
import { coerceInstituteLevelFromBaseVr } from "@/lib/vr/institute-levels.shared";
import {
  selectTopVrChartCommanders,
  type VrProgressChartEvent,
  type VrProgressChartPayload,
  type VrProgressCommanderSeries,
} from "@/lib/vr/vr-progress-chart.shared";

type LeaderboardProgressRow = {
  commanderId: string;
  ashedMemberId: string;
  highestBaseVr: number;
  instituteLevel: number | null;
  updatedAt: string | Date;
};

type ProgressMember = {
  id: string;
  current_name?: string | null;
  currentName?: string | null;
};

type ProgressDiscordLink = {
  ashedMemberId: string;
  memberDisplayName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function eventRowsForCommander(
  bulk: unknown,
  commanderId: string,
): Record<string, unknown>[] {
  if (bulk instanceof Map) {
    const rows = bulk.get(commanderId);
    return Array.isArray(rows) ? rows.map(asRecord) : [];
  }
  if (Array.isArray(bulk)) {
    return bulk
      .map(asRecord)
      .filter((row) => row.commanderId === commanderId);
  }
  const keyed = asRecord(bulk)[commanderId];
  return Array.isArray(keyed) ? keyed.map(asRecord) : [];
}

function eventFromRow(
  row: Record<string, unknown>,
  seasonKey: string,
): VrProgressChartEvent | null {
  const baseVr = Number(row.baseVr ?? row.highestBaseVr);
  const at = row.createdAt ?? row.updatedAt ?? row.at;
  if (!Number.isFinite(baseVr) || !(typeof at === "string" || at instanceof Date)) {
    return null;
  }
  const instituteLevel =
    typeof row.instituteLevel === "number"
      ? row.instituteLevel
      : coerceInstituteLevelFromBaseVr(seasonKey, baseVr);
  return {
    at: new Date(at).toISOString(),
    baseVr,
    instituteLevel,
  };
}

export async function loadVrProgressChartPayload(input: {
  allianceId: string;
  viewerCommanderId?: string | null;
  viewerAshedMemberId?: string | null;
}): Promise<VrProgressChartPayload> {
  const season = await resolveVrSeasonContext(input.allianceId);
  const [rawRows, rawMembers, rawLinks] = await Promise.all([
    listAllianceSeasonVrForLeaderboard(input.allianceId, season.seasonKey),
    loadAllianceMembersForBot(input.allianceId),
    listDiscordLinksByAlliance(input.allianceId),
  ]);
  const rows = rawRows as LeaderboardProgressRow[];
  const members = rawMembers as ProgressMember[];
  const links = rawLinks as ProgressDiscordLink[];

  const viewerCommanderId =
    input.viewerCommanderId ??
    (input.viewerAshedMemberId
      ? (
          await getCommanderByAshedMemberId(
            input.viewerAshedMemberId,
            input.allianceId,
          )
        )?.commanderId
      : null) ??
    null;

  const memberNameById = new Map(
    members.map((member) => [
      member.id,
      member.current_name ?? member.currentName ?? null,
    ]),
  );
  const linkNameById = new Map(
    links.map((link) => [link.ashedMemberId, link.memberDisplayName]),
  );
  const rankedRows = (rows as LeaderboardProgressRow[])
    .slice()
    .sort((a, b) => b.highestBaseVr - a.highestBaseVr);
  const selectedRows = selectTopVrChartCommanders(
    rankedRows.map((row) => ({
      ...row,
      currentBaseVr: row.highestBaseVr,
    })),
    viewerCommanderId,
  );
  const eventRowsByCommander = await listCommanderSeasonVrEventsBulk(
    selectedRows.map((row) => row.commanderId),
    season.seasonKey,
  );

  const series: VrProgressCommanderSeries[] = selectedRows.map((row) => {
    const events = eventRowsForCommander(eventRowsByCommander, row.commanderId)
      .map((eventRow) => eventFromRow(eventRow, season.seasonKey))
      .filter((event): event is VrProgressChartEvent => event != null)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    if (events.length === 0) {
      events.push({
        at: new Date(row.updatedAt).toISOString(),
        baseVr: row.highestBaseVr,
        instituteLevel:
          row.instituteLevel ??
          coerceInstituteLevelFromBaseVr(season.seasonKey, row.highestBaseVr),
      });
    }

    const rank = rankedRows.findIndex((ranked) => ranked.commanderId === row.commanderId) + 1;
    return {
      commanderId: row.commanderId,
      ashedMemberId: row.ashedMemberId,
      memberName:
        linkNameById.get(row.ashedMemberId) ??
        memberNameById.get(row.ashedMemberId) ??
        row.ashedMemberId,
      rank,
      currentBaseVr: row.highestBaseVr,
      isViewer: row.commanderId === viewerCommanderId,
      events,
    };
  });

  return {
    seasonKey: season.seasonKey,
    vrUpdatesLocked: season.vrUpdatesLocked,
    series,
  };
}
