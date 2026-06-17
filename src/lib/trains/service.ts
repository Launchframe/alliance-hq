import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import type {
  ConductorMechanismType,
  EventTopXConfig,
  PoolType,
  RollCandidate,
  RollResult,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";
import {
  addCalendarDays,
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";
import {
  getPoolSummary,
  markPoolEntrySelected,
  pickNextPoolEntry,
  pickRandomPoolEntry,
  poolHasEntries,
  seedPool,
  startNewPoolGeneration,
} from "@/lib/trains/pool";
import {
  getAllianceRanksAsOf,
  getMemberRankAsOf,
  isMemberEligibleForPool,
} from "@/lib/trains/rank-history";
import {
  conductorMechanismPoolType,
  generateWeekDayConfigs,
} from "@/lib/trains/templates";
import {
  getConductorRecord,
  getDayConfig,
  getWeekSchedule,
  listDayConfigsForWeek,
  replaceDayConfigs,
  upsertConductorDraft,
  upsertWeekSchedule,
} from "@/lib/trains/repository";

async function resolveTrainSeasonKey(allianceId: string): Promise<string> {
  const effective = await getEffectiveSeasonForAlliance(allianceId);
  return effective.seasonKey;
}

type AshedScoreRow = {
  id?: string;
  member_id?: string;
  memberId?: string;
  member_name?: string;
  memberName?: string;
  current_name?: string;
  score?: number;
  points?: number;
  total?: number;
};

function memberFromScore(row: AshedScoreRow): RollCandidate | null {
  const memberId = row.member_id ?? row.memberId ?? row.id;
  const memberName =
    row.member_name ?? row.memberName ?? row.current_name ?? null;
  if (!memberId || !memberName) return null;
  return { memberId: String(memberId), memberName: String(memberName) };
}

function scoreValue(row: AshedScoreRow): number {
  return Number(row.score ?? row.points ?? row.total ?? 0);
}

async function fetchVsTopScorers(
  connection: ParsedConnection,
  allianceId: string,
  limit: number,
): Promise<RollCandidate[]> {
  const path = `/entities/VSScore?q=${encodeURIComponent(JSON.stringify({ alliance_id: allianceId }))}&sort=-score&limit=${limit}`;
  const rows = await base44Json<AshedScoreRow[]>(connection, path);
  return rows
    .map(memberFromScore)
    .filter((c): c is RollCandidate => c != null)
    .slice(0, limit);
}

async function fetchTopDonor(
  connection: ParsedConnection,
  allianceId: string,
): Promise<RollCandidate | null> {
  const path = `/entities/Donation?q=${encodeURIComponent(JSON.stringify({ alliance_id: allianceId }))}&sort=-points&limit=2`;
  const rows = await base44Json<AshedScoreRow[]>(connection, path);
  const sorted = [...rows].sort((a, b) => scoreValue(b) - scoreValue(a));
  const top = sorted[0];
  return top ? memberFromScore(top) : null;
}

async function fetchSecondDonor(
  connection: ParsedConnection,
  allianceId: string,
): Promise<RollCandidate | null> {
  const path = `/entities/Donation?q=${encodeURIComponent(JSON.stringify({ alliance_id: allianceId }))}&sort=-points&limit=5`;
  const rows = await base44Json<AshedScoreRow[]>(connection, path);
  const sorted = [...rows].sort((a, b) => scoreValue(b) - scoreValue(a));
  const second = sorted[1];
  return second ? memberFromScore(second) : null;
}

async function buildPoolCandidates(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  ashedAllianceId: string;
  connection: ParsedConnection | null;
}): Promise<RollCandidate[]> {
  const [members, rankEvents] = await Promise.all([
    loadActiveAlliancePoolMembers({
      allianceId: input.hqAllianceId,
      ashedAllianceId: input.ashedAllianceId,
      connection: input.connection,
    }),
    getAllianceRanksAsOf(input.hqAllianceId, input.date),
  ]);
  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );

  const candidates: RollCandidate[] = [];
  for (const member of members) {
    const rankEvent = rankByMember.get(member.ashedMemberId);
    const rank = rankEvent?.allianceRank ?? member.allianceRank ?? null;

    if (!isMemberEligibleForPool(input.poolType, rank)) continue;

    candidates.push({
      memberId: member.ashedMemberId,
      memberName: member.currentName,
      allianceRank: rank,
    });
  }
  return candidates;
}

async function ensurePool(input: {
  hqAllianceId: string;
  ashedAllianceId: string;
  poolType: PoolType;
  date: string;
  connection: ParsedConnection | null;
  useSequence: boolean;
}): Promise<void> {
  const has = await poolHasEntries(input.hqAllianceId, input.poolType);
  if (has) return;

  const candidates = await buildPoolCandidates({
    hqAllianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    ashedAllianceId: input.ashedAllianceId,
    connection: input.connection,
  });
  if (candidates.length === 0) {
    throw new Error(`No eligible members for ${input.poolType} pool.`);
  }

  if (input.useSequence) {
    await seedPool(input.hqAllianceId, input.poolType, candidates);
  } else {
    await seedPool(input.hqAllianceId, input.poolType, candidates);
  }
}

async function rollFromPool(
  allianceId: string,
  poolType: PoolType,
  date: string,
  useSequence: boolean,
  mechanism: ConductorMechanismType | VipMechanismType,
): Promise<RollResult> {
  const summary = await getPoolSummary(allianceId, poolType);
  const entry =
    useSequence
      ? await pickNextPoolEntry(allianceId, poolType)
      : await pickRandomPoolEntry(allianceId, poolType);

  if (!entry && summary.exhausted) {
    throw new Error(
      "Pool exhausted. Re-seed the pool to start a new generation.",
    );
  }

  if (!entry) {
    throw new Error("No pool entry available.");
  }

  await markPoolEntrySelected(entry.id, date);

  return {
    memberId: entry.memberId,
    memberName: entry.memberName,
    mechanism,
    isAutomatic: false,
    poolType,
  };
}

export async function getOrCreateWeekSchedule(
  allianceId: string,
  weekStart: string,
  templateType: WeekTemplateType = "vs_push_week",
): Promise<{
  schedule: Awaited<ReturnType<typeof upsertWeekSchedule>>;
  dayConfigs: Awaited<ReturnType<typeof listDayConfigsForWeek>>;
}> {
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  let schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  if (!schedule) {
    schedule = await upsertWeekSchedule({
      allianceId,
      weekStart,
      templateType,
      seasonKey,
    });
    const configs = generateWeekDayConfigs(templateType, weekStart);
    await replaceDayConfigs(allianceId, schedule.id, configs);
  }

  const weekEnd = addCalendarDays(weekStart, 6);
  const dayConfigs = await listDayConfigsForWeek(
    allianceId,
    weekStart,
    weekEnd,
  );
  return { schedule, dayConfigs };
}

export async function setWeekTemplate(
  allianceId: string,
  weekStart: string,
  templateType: WeekTemplateType,
  isPivot = false,
): Promise<void> {
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const schedule = await upsertWeekSchedule({
    allianceId,
    weekStart,
    templateType,
    seasonKey,
    isPivot,
  });
  const configs = generateWeekDayConfigs(templateType, weekStart);
  await replaceDayConfigs(allianceId, schedule.id, configs);
}

export async function rollForConductor(input: {
  allianceId: string;
  date: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
}): Promise<RollResult> {
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const record = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (record?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  const dayConfig =
    (await getDayConfig(input.allianceId, input.date)) ??
    generateWeekDayConfigs("vs_push_week", getWeekStartMonday(input.date))[0]!;

  const mechanism = dayConfig.conductorMechanism as ConductorMechanismType;

  let result: RollResult;

  switch (mechanism) {
    case "vs_high_score": {
      if (!input.connection) {
        throw new Error(
          "VS auto-roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const top = await fetchVsTopScorers(
        input.connection,
        input.ashedAllianceId,
        1,
      );
      const winner = top[0];
      if (!winner) throw new Error("No VS scores found for Day 1.");
      result = {
        ...winner,
        mechanism,
        isAutomatic: true,
      };
      break;
    }
    case "vs_top_10": {
      if (!input.connection) {
        throw new Error(
          "VS auto-roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const top10 = await fetchVsTopScorers(
        input.connection,
        input.ashedAllianceId,
        10,
      );
      if (top10.length === 0) {
        throw new Error("No VS scores found for the wheel.");
      }
      const winner = top10[Math.floor(Math.random() * top10.length)]!;
      result = {
        ...winner,
        mechanism,
        isAutomatic: false,
      };
      break;
    }
    case "donations_top": {
      if (!input.connection) {
        throw new Error(
          "Donation auto-roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const winner = await fetchTopDonor(
        input.connection,
        input.ashedAllianceId,
      );
      if (!winner) throw new Error("No donation scores found.");
      result = { ...winner, mechanism, isAutomatic: true };
      break;
    }
    case "r3_lottery":
    case "r4_sequence": {
      const poolType = conductorMechanismPoolType(mechanism)!;
      await ensurePool({
        hqAllianceId: input.allianceId,
        ashedAllianceId: input.ashedAllianceId,
        poolType,
        date: input.date,
        connection: input.connection,
        useSequence: mechanism === "r4_sequence",
      });
      result = await rollFromPool(
        input.allianceId,
        poolType,
        input.date,
        mechanism === "r4_sequence",
        mechanism,
      );
      break;
    }
    default:
      throw new Error(`Conductor mechanism "${mechanism}" is not rollable yet.`);
  }

  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    result.memberId,
    input.date,
  );

  await upsertConductorDraft({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    conductorMemberId: result.memberId,
    conductorMemberName: result.memberName,
    conductorRankEventId: rankEvent?.id ?? null,
    conductorMechanism: mechanism,
    vipMechanism: dayConfig.vipMechanism,
    dayConfigId: "id" in dayConfig ? dayConfig.id : null,
  });

  return result;
}

export async function rollForVip(input: {
  allianceId: string;
  date: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
}): Promise<RollResult> {
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const record = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (record?.lockedAt) {
    throw new Error("Train is locked; VIP cannot be changed.");
  }

  const dayConfig =
    (await getDayConfig(input.allianceId, input.date)) ??
    generateWeekDayConfigs("vs_push_week", getWeekStartMonday(input.date))[0]!;

  const mechanism = (dayConfig.vipMechanism ?? "none") as VipMechanismType;
  if (mechanism === "none" || mechanism === "conductor_pick") {
    throw new Error("VIP is chosen by the conductor today, not by wheel.");
  }

  let result: RollResult;

  switch (mechanism) {
    case "donations_second": {
      if (!input.connection) {
        throw new Error(
          "Donation VIP roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const winner = await fetchSecondDonor(
        input.connection,
        input.ashedAllianceId,
      );
      if (!winner) throw new Error("No second-place donor found.");
      result = { ...winner, mechanism, isAutomatic: true };
      break;
    }
    case "event_top_x_lottery": {
      if (!input.connection) {
        throw new Error(
          "Event VIP roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const config = (dayConfig.vipConfig ?? {
        eventKey: "capitol_war",
        topN: 10,
      }) as EventTopXConfig;
      const top = await fetchVsTopScorers(
        input.connection,
        input.ashedAllianceId,
        config.topN ?? 10,
      );
      if (top.length === 0) {
        throw new Error("No event scores found for VIP wheel.");
      }
      const winner = top[Math.floor(Math.random() * top.length)]!;
      result = { ...winner, mechanism, isAutomatic: false, poolType: "event_top_x" };
      break;
    }
    default:
      throw new Error(`VIP mechanism "${mechanism}" is not rollable yet.`);
  }

  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    result.memberId,
    input.date,
  );

  await upsertConductorDraft({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    vipMemberId: result.memberId,
    vipMemberName: result.memberName,
    vipRankEventId: rankEvent?.id ?? null,
    vipMechanism: mechanism,
    dayConfigId: "id" in dayConfig ? dayConfig.id : null,
  });

  return result;
}

export async function reseedPool(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
  useSequence?: boolean;
}): Promise<{ generation: number; count: number }> {
  const candidates = await buildPoolCandidates({
    hqAllianceId: input.allianceId,
    ashedAllianceId: input.ashedAllianceId,
    poolType: input.poolType,
    date: input.date,
    connection: input.connection,
  });
  if (candidates.length === 0) {
    throw new Error(`No eligible members for ${input.poolType} pool.`);
  }
  return startNewPoolGeneration(input.allianceId, input.poolType, candidates);
}

export { getServerCalendarDate, getWeekStartMonday };
