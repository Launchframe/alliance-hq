import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import type {
  ConductorMechanismType,
  DayConfigInput,
  EventTopXConfig,
  PoolType,
  PoolRefreshedInfo,
  RollCandidate,
  RollResult,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";
import {
  addCalendarDays,
  getServerCalendarDate,
  getWeekStartMonday,
  weekDatesFromMonday,
} from "@/lib/trains/game-time";
import {
  throwAshedRequired,
  throwNoWheelCandidates,
  throwPoolEmpty,
  throwPoolExhausted,
  throwPoolUnavailable,
} from "@/lib/trains/roll-errors.server";
import { withPaintTemplateConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getPoolSummary,
  listPoolEntries,
  markPoolEntrySelected,
  markPoolMemberSelectedForDate,
  pickNextPoolEntry,
  pickRandomPoolEntry,
  poolHasEntries,
  releasePoolSelectionForDate,
  seedPool,
  startNewPoolGeneration,
} from "@/lib/trains/pool";
import {
  evaluateConductorQualification,
  loadTrainConductorMinimums,
} from "@/lib/trains/train-conductor-minimums.server";
import {
  assertConductorMinimumOverrideQualification,
  minimumsEnforcementEnabled,
} from "@/lib/trains/train-conductor-minimums.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import { fetchEventTopScorers } from "@/lib/trains/event-scores.server";
import {
  fetchVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";
import {
  getAllianceRanksAsOf,
  getMemberRankAsOf,
  isMemberEligibleForPool,
} from "@/lib/trains/rank-history";
import {
  conductorMechanismPoolType,
  generateDayConfigForDate,
  generateWeekDayConfigs,
  vipMechanismPoolType,
} from "@/lib/trains/templates";
import {
  getConductorRecord,
  getWeekSchedule,
  listConductorRecordsForWeek,
  listDayConfigsForWeek,
  replaceDayConfigs,
  upsertConductorDraft,
  upsertDayConfigOverride,
  upsertWeekSchedule,
} from "@/lib/trains/repository";
import { latestLockedDateInWeek } from "@/lib/trains/week-template-change.shared";

async function resolveTrainSeasonKey(allianceId: string): Promise<string> {
  const effective = await getEffectiveSeasonForAlliance(allianceId);
  return effective.seasonKey;
}

function weekDayConfigsForTemplate(
  templateType: WeekTemplateType,
  weekStart: string,
): DayConfigInput[] {
  return generateWeekDayConfigs(templateType, weekStart).map((config) =>
    withPaintTemplateConfig(
      config,
      resolvePaintTemplateForDay(templateType, config.date, weekStart),
    ),
  );
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
  eventTopN?: number;
  eventKey?: string;
}): Promise<RollCandidate[]> {
  if (input.poolType === "event_top_x") {
    if (!input.connection) return [];
    return fetchEventTopScorers(
      input.connection,
      input.ashedAllianceId,
      input.eventKey ?? "capitol_war",
      input.date,
      input.eventTopN ?? 10,
    );
  }

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
  eventTopN?: number;
  eventKey?: string;
}): Promise<void> {
  const has = await poolHasEntries(input.hqAllianceId, input.poolType);
  if (has) return;

  const candidates = await buildPoolCandidates({
    hqAllianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    ashedAllianceId: input.ashedAllianceId,
    connection: input.connection,
    eventTopN: input.eventTopN,
    eventKey: input.eventKey,
  });
  if (candidates.length === 0) {
    throwPoolEmpty(input.poolType);
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
    throwPoolExhausted(poolType);
  }

  if (!entry) {
    throwPoolUnavailable();
  }

  await markPoolEntrySelected(entry.id, date);

  const generationEntries = await listPoolEntries(allianceId, poolType);
  const seenMemberIds = new Set<string>();
  const wheelCandidates = generationEntries.flatMap((row) => {
    if (seenMemberIds.has(row.memberId)) return [];
    seenMemberIds.add(row.memberId);
    return [
      {
        memberId: row.memberId,
        memberName: row.memberName,
        allianceRank: row.allianceRank,
      },
    ];
  });

  return {
    memberId: entry.memberId,
    memberName: entry.memberName,
    mechanism,
    isAutomatic: false,
    poolType,
    wheelCandidates,
  };
}

async function applyConductorQualificationGate(input: {
  allianceId: string;
  date: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
  result: RollResult;
}): Promise<RollResult> {
  const qualification = await evaluateConductorQualification({
    allianceId: input.allianceId,
    memberId: input.result.memberId,
    trainDate: input.date,
    connection: input.connection,
    ashedAllianceId: input.ashedAllianceId,
  });

  if (qualification && !qualification.qualified) {
    if (input.result.poolType) {
      await releasePoolSelectionForDate(
        input.allianceId,
        input.date,
        input.result.memberId,
      );
    }
    return {
      ...input.result,
      qualification,
      draftPersisted: false,
    };
  }

  return {
    ...input.result,
    qualification: qualification ?? undefined,
    draftPersisted: true,
  };
}

async function persistConductorRoll(input: {
  allianceId: string;
  date: string;
  seasonKey: string;
  result: RollResult;
  mechanism: ConductorMechanismType;
  dayConfigId: string | null;
  vipMechanism?: VipMechanismType | null;
}): Promise<RollResult> {
  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    input.result.memberId,
    input.date,
  );

  await upsertConductorDraft({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey: input.seasonKey,
    conductorMemberId: input.result.memberId,
    conductorMemberName: input.result.memberName,
    conductorRankEventId: rankEvent?.id ?? null,
    conductorMechanism: input.mechanism,
    vipMechanism: input.vipMechanism,
    dayConfigId: input.dayConfigId,
  });

  return { ...input.result, draftPersisted: true };
}

export async function confirmConductorMinimumOverride(input: {
  allianceId: string;
  date: string;
  memberId: string;
  memberName: string;
  mechanism: ConductorMechanismType;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
  overrideReason?: string;
  sessionId: string;
  hqUserId?: string | null;
}): Promise<RollResult> {
  const settings = await loadTrainConductorMinimums(input.allianceId, false);
  if (!minimumsEnforcementEnabled(settings)) {
    throw new Error("Train conductor minimums are not enabled.");
  }

  const qualification = assertConductorMinimumOverrideQualification(
    await evaluateConductorQualification({
      allianceId: input.allianceId,
      memberId: input.memberId,
      trainDate: input.date,
      connection: input.connection,
      ashedAllianceId: input.ashedAllianceId,
    }),
  );

  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const record = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (record?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    seasonKey,
  );

  const poolType = conductorMechanismPoolType(input.mechanism);
  if (poolType) {
    await markPoolMemberSelectedForDate(
      input.allianceId,
      poolType,
      input.memberId,
      input.date,
    );
  }

  const result: RollResult = {
    memberId: input.memberId,
    memberName: input.memberName,
    mechanism: input.mechanism,
    isAutomatic: false,
    poolType: poolType ?? undefined,
    qualification,
  };

  const persisted = await persistConductorRoll({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    result,
    mechanism: input.mechanism,
    dayConfigId: dayConfig.dayConfigId,
    vipMechanism: dayConfig.vipMechanism,
  });

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId ?? undefined,
    action: "trains.conductor_minimum_override",
    resourceType: "train_conductor_record",
    resourceId: `${input.allianceId}:${input.date}`,
    resourceName: input.memberName,
    metadata: {
      date: input.date,
      memberId: input.memberId,
      mechanism: input.mechanism,
      overrideReason: input.overrideReason?.trim() || null,
      qualification,
    },
  });

  return persisted;
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
    await replaceDayConfigs(
      allianceId,
      schedule.id,
      weekDayConfigsForTemplate(templateType, weekStart),
    );
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
  const weekEnd = addCalendarDays(weekStart, 6);
  const records = await listConductorRecordsForWeek(
    allianceId,
    weekStart,
    weekEnd,
    seasonKey,
  );
  const preserveThroughDate = latestLockedDateInWeek(
    records.map((record) => ({
      date: record.date,
      lockedAt: record.lockedAt?.toISOString() ?? null,
    })),
    weekStart,
    weekEnd,
  );

  const schedule = await upsertWeekSchedule({
    allianceId,
    weekStart,
    templateType,
    seasonKey,
    isPivot,
  });
  const configs = weekDayConfigsForTemplate(templateType, weekStart);
  const configsToApply = preserveThroughDate
    ? configs.filter((config) => config.date > preserveThroughDate)
    : configs;

  if (configsToApply.length > 0) {
    await replaceDayConfigs(allianceId, schedule.id, configsToApply);
  }
}

export async function ensureWeekScheduleBaseline(
  allianceId: string,
  weekStart: string,
  templateType: WeekTemplateType = "vs_push_week",
): Promise<(typeof import("@/lib/db/schema").trainWeekSchedules.$inferSelect)> {
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  let schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  if (!schedule) {
    schedule = await upsertWeekSchedule({
      allianceId,
      weekStart,
      templateType,
      seasonKey,
    });
    await replaceDayConfigs(
      allianceId,
      schedule.id,
      weekDayConfigsForTemplate(templateType, weekStart),
    );
  }
  return schedule;
}

export async function recomputeWeekPivotFlag(
  allianceId: string,
  weekStart: string,
): Promise<void> {
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  if (!schedule || schedule.templateType !== "vs_push_week") {
    return;
  }

  const weekEnd = addCalendarDays(weekStart, 6);
  const configs = await listDayConfigsForWeek(allianceId, weekStart, weekEnd);
  const hasEconomyOverride = configs.some((config) => {
    if (config.isOverride !== 1) return false;
    const idx = weekDatesFromMonday(weekStart).indexOf(config.date);
    return idx >= 1 && config.conductorMechanism === "r3_lottery";
  });

  if ((schedule.isPivot === 1) === hasEconomyOverride) {
    return;
  }

  await upsertWeekSchedule({
    allianceId,
    weekStart,
    templateType: schedule.templateType as WeekTemplateType,
    seasonKey,
    isPivot: hasEconomyOverride,
  });
}

export async function applyTemplateToDates(
  allianceId: string,
  dates: string[],
  templateType: WeekTemplateType,
): Promise<void> {
  if (dates.length === 0) return;

  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const uniqueDates = [...new Set(dates)].sort();

  for (const date of uniqueDates) {
    const record = await getConductorRecord(allianceId, date, seasonKey);
    if (record?.lockedAt) {
      throw new Error(`Cannot repaint locked day ${date}.`);
    }
  }

  const weekStarts = [...new Set(uniqueDates.map((d) => getWeekStartMonday(d)))];
  for (const weekStart of weekStarts) {
    await ensureWeekScheduleBaseline(allianceId, weekStart);
  }

  for (const date of uniqueDates) {
    const weekStart = getWeekStartMonday(date);
    const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
    if (!schedule) continue;

    const config = generateDayConfigForDate(templateType, date, weekStart);
    await upsertDayConfigOverride(
      allianceId,
      schedule.id,
      withPaintTemplateConfig(
        config,
        resolvePaintTemplateForDay(templateType, date, weekStart),
      ),
      true,
    );
  }

  for (const weekStart of weekStarts) {
    await recomputeWeekPivotFlag(allianceId, weekStart);
  }
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

  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    seasonKey,
  );

  const mechanism = dayConfig.conductorMechanism as ConductorMechanismType;

  let result: RollResult;

  switch (mechanism) {
    case "vs_high_score": {
      if (!input.connection) {
        throwAshedRequired(
          "VS auto-roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const top = await fetchVsTopScorersForTrainDate(
        input.connection,
        input.ashedAllianceId,
        input.date,
        1,
      );
      const winner = top[0];
      if (!winner) throw new Error("No VS scores found for the leaderboard.");
      result = {
        ...winner,
        mechanism,
        isAutomatic: true,
      };
      break;
    }
    case "vs_top_10": {
      if (!input.connection) {
        throwAshedRequired(
          "VS auto-roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const top10 = await fetchVsTopScorersForTrainDate(
        input.connection,
        input.ashedAllianceId,
        input.date,
        10,
      );
      if (top10.length === 0) {
        throwNoWheelCandidates("vs", "No VS scores found for the wheel.");
      }
      const winner = top10[Math.floor(Math.random() * top10.length)]!;
      result = {
        ...winner,
        mechanism,
        isAutomatic: false,
        wheelCandidates: top10,
      };
      break;
    }
    case "donations_top": {
      if (!input.connection) {
        throwAshedRequired(
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
      if (record?.conductorMemberId) {
        await releasePoolSelectionForDate(
          input.allianceId,
          input.date,
          record.conductorMemberId,
        );
      }
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
      const poolRefreshed = await refreshExhaustedPoolIfNeeded({
        allianceId: input.allianceId,
        poolType,
        date: input.date,
        connection: input.connection,
        ashedAllianceId: input.ashedAllianceId,
      });
      if (poolRefreshed) {
        result = { ...result, poolRefreshed };
      }
      break;
    }
    default:
      throw new Error(`Conductor mechanism "${mechanism}" is not rollable yet.`);
  }

  const gated = await applyConductorQualificationGate({
    allianceId: input.allianceId,
    date: input.date,
    connection: input.connection,
    ashedAllianceId: input.ashedAllianceId,
    result,
  });

  if (!gated.draftPersisted) {
    return gated;
  }

  return persistConductorRoll({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    result: gated,
    mechanism,
    dayConfigId: dayConfig.dayConfigId,
    vipMechanism: dayConfig.vipMechanism,
  });
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

  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    seasonKey,
  );

  const mechanism = (dayConfig.vipMechanism ?? "none") as VipMechanismType;
  if (mechanism === "none" || mechanism === "conductor_pick") {
    throw new Error("VIP is chosen by the conductor today, not by wheel.");
  }

  let result: RollResult;

  switch (mechanism) {
    case "donations_second": {
      if (!input.connection) {
        throwAshedRequired(
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
        throwAshedRequired(
          "Event VIP roll requires an Ashed connection. Use a roster pool mechanism for native alliances.",
        );
      }
      const config = (dayConfig.vipConfig ?? {
        eventKey: "capitol_war",
        topN: 10,
      }) as EventTopXConfig;
      const poolType: PoolType = "event_top_x";
      if (record?.vipMemberId) {
        await releasePoolSelectionForDate(
          input.allianceId,
          input.date,
          record.vipMemberId,
        );
      }
      await ensurePool({
        hqAllianceId: input.allianceId,
        ashedAllianceId: input.ashedAllianceId,
        poolType,
        date: input.date,
        connection: input.connection,
        useSequence: false,
        eventTopN: config.topN ?? 10,
        eventKey: config.eventKey,
      });
      result = await rollFromPool(
        input.allianceId,
        poolType,
        input.date,
        false,
        mechanism,
      );
      const poolRefreshed = await refreshExhaustedPoolIfNeeded({
        allianceId: input.allianceId,
        poolType,
        date: input.date,
        connection: input.connection,
        ashedAllianceId: input.ashedAllianceId,
        eventTopN: config.topN ?? 10,
        eventKey: config.eventKey,
      });
      if (poolRefreshed) {
        result = { ...result, poolRefreshed };
      }
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
    dayConfigId: dayConfig.dayConfigId,
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
  eventTopN?: number;
  eventKey?: string;
}): Promise<{ generation: number; count: number }> {
  const candidates = await buildPoolCandidates({
    hqAllianceId: input.allianceId,
    ashedAllianceId: input.ashedAllianceId,
    poolType: input.poolType,
    date: input.date,
    connection: input.connection,
    eventTopN: input.eventTopN,
    eventKey: input.eventKey,
  });
  if (candidates.length === 0) {
    throwPoolEmpty(input.poolType);
  }
  return startNewPoolGeneration(input.allianceId, input.poolType, candidates);
}

/** After the last pool pick, start the next generation so future rolls keep working. */
export async function refreshExhaustedPoolIfNeeded(
  input: Parameters<typeof reseedPool>[0],
): Promise<PoolRefreshedInfo | null> {
  const summary = await getPoolSummary(input.allianceId, input.poolType);
  if (!summary.exhausted) return null;
  try {
    const refreshed = await reseedPool(input);
    return {
      poolType: input.poolType,
      generation: refreshed.generation,
      memberCount: refreshed.count,
    };
  } catch {
    return null;
  }
}

export async function refreshExhaustedPoolsForDay(input: {
  allianceId: string;
  date: string;
  connection: ParsedConnection | null;
  ashedAllianceId: string;
  seasonKey: string;
}): Promise<PoolRefreshedInfo[]> {
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    input.seasonKey,
  );
  const refreshed: PoolRefreshedInfo[] = [];
  const base = {
    allianceId: input.allianceId,
    date: input.date,
    connection: input.connection,
    ashedAllianceId: input.ashedAllianceId,
  };

  const conductorPool = conductorMechanismPoolType(dayConfig.conductorMechanism);
  if (conductorPool) {
    const next = await refreshExhaustedPoolIfNeeded({
      ...base,
      poolType: conductorPool,
    });
    if (next) refreshed.push(next);
  }

  const vipPool = vipMechanismPoolType(
    (dayConfig.vipMechanism ?? "none") as VipMechanismType,
  );
  if (vipPool) {
    const vipConfig = (dayConfig.vipConfig ?? {
      eventKey: "capitol_war",
      topN: 10,
    }) as EventTopXConfig;
    const next = await refreshExhaustedPoolIfNeeded({
      ...base,
      poolType: vipPool,
      eventTopN: vipConfig.topN ?? 10,
    });
    if (next) refreshed.push(next);
  }

  return refreshed;
}

export { getServerCalendarDate, getWeekStartMonday };
