import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadActiveAlliancePoolMembers, loadAllianceRow } from "@/lib/members/game-roster";
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
  weekDatesFromMonday,
} from "@/lib/trains/game-time";
import {
  canOfficerChangeTemplateForDate,
  canRollForDate,
} from "@/lib/trains/trains-day-actions.shared";
import {
  allianceTrainWeekFromRow,
  getTrainWeekStart,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";
import {
  throwNoWheelCandidates,
  throwPoolEmpty,
  throwPoolExhausted,
  throwPoolUnavailable,
} from "@/lib/trains/roll-errors.server";
import { withPaintTemplateConfig } from "@/lib/trains/calendar-cell-styles.shared";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  buildPriceIsRightWeightedCandidates,
  filterPoolByEconomyThreshold,
  loadPriceIsRightTicketSettings,
} from "@/lib/trains/train-economy-threshold.server";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import {
  getPoolSummary,
  listPoolEntries,
  markPoolEntrySelected,
  markPoolMemberSelectedForDate,
  pickNextPoolEntry,
  pickRandomPoolEntry,
  pickWeightedRandomPoolEntry,
  poolHasEntries,
  releasePoolSelectionForDate,
  seedPool,
  startNewPoolGeneration,
  updateCurrentPoolEntryTicketWeights,
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
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
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
  clearConductorAssignment,
  deleteWeekScheduleAndDayConfigs,
  getConductorRecord,
  getWeekSchedule,
  listConductorRecordsForWeek,
  listDayConfigsForWeek,
  lockConductorRecord,
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

export class TrainPastDateError extends Error {
  readonly status = 409 as const;

  constructor(message: string) {
    super(message);
    this.name = "TrainPastDateError";
  }
}

export async function loadAllianceTrainWeekConfig(
  allianceId: string,
): Promise<AllianceTrainWeekConfig> {
  const row = await loadAllianceRow(allianceId);
  return allianceTrainWeekFromRow(row ?? {});
}

export function assertRollAllowed(
  date: string,
  today = getServerCalendarDate(),
): void {
  if (!canRollForDate(date, today)) {
    throw new TrainPastDateError("Cannot roll for a past train day.");
  }
}

export function assertTemplateChangeAllowed(
  date: string,
  isPlatformAdmin: boolean,
  today = getServerCalendarDate(),
): void {
  if (
    !isPlatformAdmin &&
    !canOfficerChangeTemplateForDate(date, today)
  ) {
    throw new TrainPastDateError(`Cannot change template for past day ${date}.`);
  }
}

export function trainActionErrorResponse(error: unknown): {
  status: number;
  body: { error: string };
} {
  if (error instanceof TrainPastDateError) {
    return { status: error.status, body: { error: error.message } };
  }

  const message =
    error instanceof Error ? error.message : "Request failed.";
  const status = message.includes("locked") ? 409 : 400;
  return { status, body: { error: message } };
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

async function fetchVsTopScorersForTrainDateResolved(input: {
  hqAllianceId: string;
  limit: number;
}): Promise<RollCandidate[]> {
  return fetchNativeVrTopScorers(input.hqAllianceId, input.limit);
}

async function buildPoolCandidates(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  eventTopN?: number;
  paintTemplate?: WeekTemplateType | null;
}): Promise<RollCandidate[]> {
  if (input.poolType === "event_top_x") {
    const limit = input.eventTopN ?? 10;
    return fetchNativeVrTopScorers(input.hqAllianceId, limit);
  }

  if (input.poolType === "heavy_hitter") {
    return buildHeavyHitterPoolCandidates(input.hqAllianceId, input.date);
  }

  const [members, rankEvents] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId: input.hqAllianceId }),
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

  if (input.paintTemplate === "price_is_right") {
    const ticketSettings = await loadPriceIsRightTicketSettings(
      input.hqAllianceId,
    );
    if (priceIsRightWeightingActive(ticketSettings)) {
      const weighted = await buildPriceIsRightWeightedCandidates({
        allianceId: input.hqAllianceId,
        trainDate: input.date,
        candidates,
        settings: ticketSettings,
      });
      return weighted.candidates;
    }

    return filterPoolByEconomyThreshold({
      allianceId: input.hqAllianceId,
      trainDate: input.date,
      candidates,
    });
  }

  return candidates;
}

async function ensurePool(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  useSequence: boolean;
  eventTopN?: number;
  paintTemplate?: WeekTemplateType | null;
}): Promise<void> {
  const has = await poolHasEntries(input.hqAllianceId, input.poolType);
  if (has) return;

  const candidates = await buildPoolCandidates({
    hqAllianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    eventTopN: input.eventTopN,
    paintTemplate: input.paintTemplate,
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

async function refreshPriceIsRightPoolTicketWeights(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
}): Promise<void> {
  const entries = await listPoolEntries(input.allianceId, input.poolType);
  if (entries.length === 0) return;

  const settings = await loadPriceIsRightTicketSettings(input.allianceId);
  if (!priceIsRightWeightingActive(settings)) return;

  const weighted = await buildPriceIsRightWeightedCandidates({
    allianceId: input.allianceId,
    trainDate: input.date,
    candidates: entries.map((entry) => ({
      memberId: entry.memberId,
      memberName: entry.memberName,
      allianceRank: entry.allianceRank,
    })),
    settings,
  });

  await updateCurrentPoolEntryTicketWeights(
    input.allianceId,
    input.poolType,
    weighted.candidates.map((candidate) => ({
      memberId: candidate.memberId,
      ticketCount: candidate.ticketCount ?? 0,
      priorDayVsScore: candidate.priorDayVsScore ?? null,
    })),
  );
}

async function rollFromPool(
  allianceId: string,
  poolType: PoolType,
  date: string,
  useSequence: boolean,
  mechanism: ConductorMechanismType | VipMechanismType,
  useWeightedPick = false,
): Promise<RollResult> {
  const summary = await getPoolSummary(allianceId, poolType);
  const entry =
    useSequence
      ? await pickNextPoolEntry(allianceId, poolType)
      : useWeightedPick
        ? await pickWeightedRandomPoolEntry(allianceId, poolType)
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
  result: RollResult;
}): Promise<RollResult> {
  const qualification = await evaluateConductorQualification({
    allianceId: input.allianceId,
    memberId: input.result.memberId,
    trainDate: input.date,
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

/**
 * Pre-production helper: remove the persisted week schedule and day configs so
 * the dashboard returns to draft preview. Conductor records are left intact.
 */
export async function clearWeekSchedule(
  allianceId: string,
  weekStart: string,
): Promise<{ deletedSchedule: boolean; deletedDayConfigs: number }> {
  const weekEnd = addCalendarDays(weekStart, 6);
  return deleteWeekScheduleAndDayConfigs(allianceId, weekStart, weekEnd);
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
  options?: {
    platformAdminPastOverride?: boolean;
    /** When true, persist the week schedule's templateType (week template dropdown). */
    updateWeekTemplate?: boolean;
  },
): Promise<void> {
  if (dates.length === 0) return;

  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const trainWeekConfig = await loadAllianceTrainWeekConfig(allianceId);
  const uniqueDates = [...new Set(dates)].sort();
  const today = getServerCalendarDate();
  const isPlatformAdmin = options?.platformAdminPastOverride ?? false;

  for (const date of uniqueDates) {
    assertTemplateChangeAllowed(date, isPlatformAdmin, today);
    const record = await getConductorRecord(allianceId, date, seasonKey);
    if (record?.lockedAt) {
      throw new Error(`Cannot repaint locked day ${date}.`);
    }
  }

  const weekStarts = [
    ...new Set(uniqueDates.map((d) => getTrainWeekStart(d, trainWeekConfig))),
  ];
  for (const weekStart of weekStarts) {
    await ensureWeekScheduleBaseline(allianceId, weekStart);
  }

  for (const date of uniqueDates) {
    const weekStart = getTrainWeekStart(date, trainWeekConfig);
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
    if (options?.updateWeekTemplate) {
      const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
      if (schedule) {
        await upsertWeekSchedule({
          allianceId,
          weekStart,
          templateType,
          seasonKey,
          isPivot: schedule.isPivot === 1,
        });
      }
    }
    await recomputeWeekPivotFlag(allianceId, weekStart);
  }
}

export async function rollForConductor(input: {
  allianceId: string;
  date: string;
}): Promise<RollResult> {
  assertRollAllowed(input.date);

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
      const top = await fetchVsTopScorersForTrainDateResolved({
        hqAllianceId: input.allianceId,
        limit: 1,
      });
      const winner = top[0];
      if (!winner) {
        throwNoWheelCandidates(
          "vs",
          "No VR standings found for the wheel.",
        );
      }
      result = {
        ...winner,
        mechanism,
        isAutomatic: true,
      };
      break;
    }
    case "vs_top_10": {
      const top10 = await fetchVsTopScorersForTrainDateResolved({
        hqAllianceId: input.allianceId,
        limit: 10,
      });
      if (top10.length === 0) {
        throwNoWheelCandidates("vs", "No VR standings found for the wheel.");
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
      throwNoWheelCandidates(
        "donation",
        "Donation wheels require a manual conductor pick — HQ does not store donation scores yet.",
      );
    }
    case "r3_lottery":
    case "heavy_hitter_lottery":
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
        poolType,
        date: input.date,
        useSequence: mechanism === "r4_sequence",
        paintTemplate: dayConfig.paintTemplate,
      });
      const pirSettings =
        mechanism === "r3_lottery" &&
        dayConfig.paintTemplate === "price_is_right"
          ? await loadPriceIsRightTicketSettings(input.allianceId)
          : null;
      const useWeightedPick =
        pirSettings != null && priceIsRightWeightingActive(pirSettings);
      if (useWeightedPick) {
        await refreshPriceIsRightPoolTicketWeights({
          allianceId: input.allianceId,
          poolType,
          date: input.date,
        });
      }
      result = await rollFromPool(
        input.allianceId,
        poolType,
        input.date,
        mechanism === "r4_sequence",
        mechanism,
        useWeightedPick,
      );
      const poolRefreshed = await refreshExhaustedPoolIfNeeded({
        allianceId: input.allianceId,
        poolType,
        date: input.date,
        paintTemplate: dayConfig.paintTemplate,
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
}): Promise<RollResult> {
  assertRollAllowed(input.date);

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
      throwNoWheelCandidates(
        "donation",
        "Donation wheels require a manual VIP pick — HQ does not store donation scores yet.",
      );
    }
    case "event_top_x_lottery": {
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
        poolType,
        date: input.date,
        useSequence: false,
        eventTopN: config.topN ?? 10,
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
        eventTopN: config.topN ?? 10,
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
    conductorMechanism: dayConfig.conductorMechanism,
    vipMechanism: mechanism,
    dayConfigId: dayConfig.dayConfigId,
  });

  return result;
}

export async function reseedPool(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
  useSequence?: boolean;
  eventTopN?: number;
  paintTemplate?: WeekTemplateType | null;
}): Promise<{ generation: number; count: number }> {
  const candidates = await buildPoolCandidates({
    hqAllianceId: input.allianceId,
    poolType: input.poolType,
    date: input.date,
    eventTopN: input.eventTopN,
    paintTemplate: input.paintTemplate,
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
  };

  const conductorPool = conductorMechanismPoolType(dayConfig.conductorMechanism);
  if (conductorPool) {
    const next = await refreshExhaustedPoolIfNeeded({
      ...base,
      poolType: conductorPool,
      paintTemplate: dayConfig.paintTemplate,
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

export async function lockConductorsForDates(input: {
  allianceId: string;
  dates: string[];
}): Promise<{
  records: Awaited<ReturnType<typeof lockConductorRecord>>[];
  poolsRefreshed: PoolRefreshedInfo[];
}> {
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const uniqueDates = [...new Set(input.dates)].sort();
  const records: Awaited<ReturnType<typeof lockConductorRecord>>[] = [];
  const poolsRefreshed: PoolRefreshedInfo[] = [];

  for (const date of uniqueDates) {
    const record = await getConductorRecord(input.allianceId, date, seasonKey);
    if (!record) {
      throw new Error(`Roll a conductor for ${date} before locking.`);
    }
    if (record.lockedAt) {
      continue;
    }
    if (!record.conductorMemberId || !record.conductorMemberName) {
      throw new Error(`Select a conductor for ${date} before locking.`);
    }

    const locked = await lockConductorRecord(record.id, input.allianceId);
    records.push(locked);
    const refreshed = await refreshExhaustedPoolsForDay({
      allianceId: input.allianceId,
      date,
      seasonKey,
    });
    poolsRefreshed.push(...refreshed);
  }

  return { records, poolsRefreshed };
}

export async function swapConductors(input: {
  allianceId: string;
  dateA: string;
  dateB: string;
}): Promise<{
  records: Awaited<ReturnType<typeof lockConductorRecord>>[];
}> {
  if (input.dateA === input.dateB) {
    throw new Error("Pick two different days to swap.");
  }

  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const recordA = await getConductorRecord(
    input.allianceId,
    input.dateA,
    seasonKey,
  );
  const recordB = await getConductorRecord(
    input.allianceId,
    input.dateB,
    seasonKey,
  );

  if (!recordA?.conductorMemberId || !recordA.conductorMemberName) {
    throw new Error(`No conductor set for ${input.dateA}.`);
  }

  if (recordA.lockedAt || recordB?.lockedAt) {
    throw new Error("Unlock conductor days before swapping.");
  }

  const targetHasConductor =
    Boolean(recordB?.conductorMemberId && recordB.conductorMemberName);

  if (targetHasConductor) {
    const rankForA = await getMemberRankAsOf(
      input.allianceId,
      recordB!.conductorMemberId!,
      input.dateA,
    );
    const rankForB = await getMemberRankAsOf(
      input.allianceId,
      recordA.conductorMemberId,
      input.dateB,
    );

    await upsertConductorDraft({
      allianceId: input.allianceId,
      date: input.dateA,
      seasonKey,
      conductorMemberId: recordB!.conductorMemberId,
      conductorMemberName: recordB!.conductorMemberName,
      conductorRankEventId: rankForA?.id ?? null,
      substituteForMemberId: recordA.conductorMemberId,
      substituteForMemberName: recordA.conductorMemberName,
    });

    await upsertConductorDraft({
      allianceId: input.allianceId,
      date: input.dateB,
      seasonKey,
      conductorMemberId: recordA.conductorMemberId,
      conductorMemberName: recordA.conductorMemberName,
      conductorRankEventId: rankForB?.id ?? null,
      substituteForMemberId: recordB!.conductorMemberId,
      substituteForMemberName: recordB!.conductorMemberName,
    });
  } else {
    const rankForB = await getMemberRankAsOf(
      input.allianceId,
      recordA.conductorMemberId,
      input.dateB,
    );

    await upsertConductorDraft({
      allianceId: input.allianceId,
      date: input.dateB,
      seasonKey,
      conductorMemberId: recordA.conductorMemberId,
      conductorMemberName: recordA.conductorMemberName,
      conductorRankEventId: rankForB?.id ?? null,
      substituteForMemberId: null,
      substituteForMemberName: null,
    });

    await clearConductorAssignment(
      input.allianceId,
      input.dateA,
      seasonKey,
    );
  }

  const draftA = await getConductorRecord(
    input.allianceId,
    input.dateA,
    seasonKey,
  );
  const draftB = await getConductorRecord(
    input.allianceId,
    input.dateB,
    seasonKey,
  );

  const lockedRecords: Awaited<ReturnType<typeof lockConductorRecord>>[] = [];

  if (draftB?.conductorMemberId && draftB.conductorMemberName) {
    lockedRecords.push(
      await lockConductorRecord(draftB.id, input.allianceId),
    );
  }

  if (
    targetHasConductor &&
    draftA?.conductorMemberId &&
    draftA.conductorMemberName
  ) {
    lockedRecords.push(await lockConductorRecord(draftA.id, input.allianceId));
  }

  if (lockedRecords.length === 0) {
    throw new Error("Swap failed to persist conductor assignment.");
  }

  return { records: lockedRecords };
}

export { getServerCalendarDate };
export { getWeekStartMonday } from "@/lib/trains/game-time";
