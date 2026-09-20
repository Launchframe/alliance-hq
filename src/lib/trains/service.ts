import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadTimeOffAvailability } from "@/lib/time-off/availability.server";
import { CoverageConflictError } from "@/lib/time-off/coverage.server";
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
  weekDatesInTrainWeek,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";
import {
  throwNoWheelCandidates,
  throwPoolEmpty,
  throwPoolExhausted,
  throwPoolUnavailable,
} from "@/lib/trains/roll-errors.server";
import {
  resolveRollDayConfig,
} from "@/lib/trains/day-config-resolve.server";
import { conductorRuleChanged } from "@/lib/trains/conductor-mechanism.shared";
import {
  mergeDayRulePatch,
  parseConductorRule,
  vipRuleIdentity,
  type ConductorRule,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import {
  conductorRulePoolType,
  conductorRuleUsesPriceIsFreightRoll,
  vipRulePoolType,
} from "@/lib/trains/rules/derive.shared";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
} from "@/lib/trains/train-economy-threshold.server";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import { rollPriceIsFreightConductor } from "@/lib/trains/price-is-freight-roll.server";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import { shouldReleasePriorPoolSelection } from "@/lib/trains/depleting-manual-pick.shared";
import { withConductorPoolClaimLock } from "@/lib/trains/conductor-pool-claim-lock.server";
import {
  getPoolSummary,
  listPoolEntries,
  listUnselectedPoolEntries,
  markPoolEntrySelected,
  markPoolMemberSelectedForDate,
  pickUniformPoolEntry,
  pickWeightedPoolEntryFromRows,
  releasePoolSelectionForDate,
  seedPool,
  startNewPoolGeneration,
} from "@/lib/trains/pool";
import {
  evaluateConductorQualification,
  filterMemberIdsByConductorMinimums,
  loadTrainConductorMinimums,
  resolveConductorQualificationGateApplies,
  resolvePoolRespectsConductorMinimums,
} from "@/lib/trains/train-conductor-minimums.server";
import {
  assertConductorMinimumOverrideQualification,
  minimumsEnforcementEnabled,
} from "@/lib/trains/train-conductor-minimums.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  isVrTopScopeUnlocked,
} from "@/lib/trains/conductor-top-n.shared";
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import { fetchAllianceVsTopScorersForTrainDate } from "@/lib/trains/vs-scores.server";
import {
  loadAllianceTrainLeadTimeDays,
  loadAllianceTrainLeadTimeSettings,
} from "@/lib/trains/alliance-train-lead-time.server";
import { conductorLockBlockedByPendingConfirmation } from "@/lib/trains/conductor-record.shared";
import { loadWeekFillTemplateById } from "@/lib/trains/rules/week-template-resolve.server";
import { getRuleTemplateByPresetKey } from "@/lib/trains/rules/templates.server";
import { templateRulesForDate } from "@/lib/trains/rules/template-days.shared";
import type { WeekFillTemplate } from "@/lib/trains/week-schedule-day-configs.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import {
  effectiveConductorRuleForTrainDate,
  resolveVsBoardForTrainDate,
} from "@/lib/trains/vs-score-scope.shared";
import {
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
} from "@/lib/trains/rules/encode.shared";
import { countAllianceVrReporters } from "@/lib/trains/vr-reporter-count.server";
import {
  buildDaySpinExclusionSet,
  filterDaySpinCandidates,
  usesDaySpinExclusions,
} from "@/lib/trains/day-spin-exclusions.shared";
import {
  listDaySpinExcludedMemberIds,
  recordDaySpinExclusion,
} from "@/lib/trains/day-spin-exclusions.server";
import {
  getAllianceRanksAsOf,
  memberIdsEligibleForPoolType,
  resolveMemberPoolAllianceRank,
  getMemberRankAsOf,
  isMemberEligibleForPool,
  resolveMemberAllianceRankAsOf,
} from "@/lib/trains/rank-history";
import {
  clearConductorAssignment,
  clearVipAssignment,
  deleteWeekScheduleAndDayConfigs,
  getConductorRecord,
  getWeekSchedule,
  listConductorRecordsForWeek,
  listConductorRecordsInRange,
  listDayConfigsForWeek,
  lockConductorRecord,
  replaceDayConfigs,
  assignVipOnLockedConductor,
  upsertConductorDraft,
  upsertDayConfigOverride,
  upsertWeekSchedule,
  restampConductorRules,
} from "@/lib/trains/repository";
import { latestLockedDateInWeek } from "@/lib/trains/week-template-change.shared";
import { shouldKeepAssignedConductorOnPaint } from "@/lib/trains/paint-rule-conductor-gate.shared";

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

export class LockedDayPaintBlockedError extends Error {
  readonly status = 409 as const;
  readonly code = "locked_day_paint_blocked" as const;

  constructor(
    readonly date: string,
    readonly conductorName: string | null,
  ) {
    super(`Cannot repaint locked day ${date}.`);
    this.name = "LockedDayPaintBlockedError";
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
  body: {
    error: string;
    code?: string;
    date?: string;
    conductorName?: string | null;
  };
} {
  if (error instanceof TrainPastDateError) {
    return { status: error.status, body: { error: error.message } };
  }
  if (error instanceof LockedDayPaintBlockedError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        date: error.date,
        conductorName: error.conductorName,
      },
    };
  }

  const message =
    error instanceof Error ? error.message : "Request failed.";
  const status = message.includes("locked") ? 409 : 400;
  return { status, body: { error: message } };
}

/** Seven day configs for a week from a template's calendar-weekday slots. */
function weekDayConfigsForTemplate(
  template: WeekFillTemplate,
  weekStart: string,
): DayConfigInput[] {
  return weekDatesInTrainWeek(weekStart).map((date) => {
    const rules = templateRulesForDate(template.days, date);
    return {
      date,
      conductorRule: rules.conductorRule,
      vipRule: rules.vipRule,
      sourceTemplateId: template.id,
    };
  });
}

async function fetchVsTopScorersForTrainDateResolved(input: {
  hqAllianceId: string;
  trainDate: string;
  limit: number;
  leadDays?: number;
}): Promise<RollCandidate[]> {
  return fetchAllianceVsTopScorersForTrainDate(
    input.hqAllianceId,
    input.trainDate,
    input.limit,
    input.leadDays ?? 0,
  );
}

async function buildPoolCandidates(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  eventTopN?: number;
  rule?: ConductorRule | null;
  /** When true, drop members who fail alliance conductor minimums. */
  respectConductorMinimums?: boolean;
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
    const rank = resolveMemberPoolAllianceRank(member, rankEvent);

    if (!isMemberEligibleForPool(input.poolType, rank)) continue;

    candidates.push({
      memberId: member.ashedMemberId,
      memberName: member.currentName,
      allianceRank: rank,
    });
  }

  let poolCandidates = candidates;
  if (input.rule?.kind === "price_is_freight" && input.rule.board === "weekday") {
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
      poolCandidates = weighted.candidates;
    }
  }

  if (!input.respectConductorMinimums) {
    return poolCandidates;
  }

  const qualifiedIds = await filterMemberIdsByConductorMinimums(
    input.hqAllianceId,
    input.date,
    poolCandidates.map((candidate) => candidate.memberId),
  );
  if (qualifiedIds == null) {
    return poolCandidates;
  }
  const qualified = new Set(qualifiedIds);
  return poolCandidates.filter((candidate) => qualified.has(candidate.memberId));
}

async function countPoolCandidates(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  rule?: ConductorRule | null;
  respectConductorMinimums: boolean;
}): Promise<number> {
  const candidates = await buildPoolCandidates({
    hqAllianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    rule: input.rule,
    respectConductorMinimums: input.respectConductorMinimums,
  });
  return candidates.length;
}

/** Non-blocking probe for roster readiness on rank-based conductor pools. */
export async function countEligiblePoolMembers(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  rule?: ConductorRule | null;
}): Promise<number> {
  const respectConductorMinimums = await resolvePoolRespectsConductorMinimums({
    allianceId: input.hqAllianceId,
    poolType: input.poolType,
    rule: input.rule,
  });
  return countPoolCandidates({
    ...input,
    respectConductorMinimums,
  });
}

/** Rank-only pool size before conductor minimums filter. */
export async function countRankEligiblePoolMembers(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  paintTemplate?: WeekTemplateType | null;
}): Promise<number> {
  return countPoolCandidates({ ...input, respectConductorMinimums: false });
}

type DepletingPoolClaimEligibility = {
  /** `null` means conductor minimums are off — treat every member as qualified. */
  minimumsQualifiedIds: string[] | null;
  /** `null` means rank filter does not apply for this pool type. */
  rankEligibleIds: Set<string> | null;
};

/**
 * Resolve Ashed-minimums + roster-rank filters once per roll.
 * Must run outside {@link withConductorPoolClaimLock} — those fetches are slow
 * and must not pin the advisory lock across gateway timeouts.
 */
async function resolveDepletingPoolClaimEligibility(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
  respectConductorMinimums: boolean;
  memberIds: readonly string[];
}): Promise<DepletingPoolClaimEligibility> {
  let minimumsQualifiedIds: string[] | null = null;
  if (input.respectConductorMinimums) {
    minimumsQualifiedIds = await filterMemberIdsByConductorMinimums(
      input.allianceId,
      input.date,
      input.memberIds,
    );
  }

  let rankEligibleIds: Set<string> | null = null;
  if (input.poolType === "r3" || input.poolType === "r4_plus") {
    const idsForRank =
      minimumsQualifiedIds != null ? minimumsQualifiedIds : input.memberIds;
    rankEligibleIds = await memberIdsEligibleForPoolType(
      input.allianceId,
      input.poolType,
      input.date,
      idsForRank,
    );
  }

  return { minimumsQualifiedIds, rankEligibleIds };
}

function applyDepletingPoolClaimEligibility<T extends { memberId: string }>(
  rows: T[],
  eligibility: DepletingPoolClaimEligibility,
): T[] {
  let next = rows;
  if (eligibility.minimumsQualifiedIds != null) {
    const qualified = new Set(eligibility.minimumsQualifiedIds);
    next = next.filter((row) => qualified.has(row.memberId));
  }
  if (eligibility.rankEligibleIds != null) {
    next = next.filter((row) =>
      eligibility.rankEligibleIds!.has(row.memberId),
    );
  }
  return next;
}

async function poolHasViableUnselectedEntries(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
  respectConductorMinimums: boolean;
  /** When provided, skip a second Ashed/rank pass (caller already resolved). */
  claimEligibility?: DepletingPoolClaimEligibility;
}): Promise<boolean> {
  const summary = await getPoolSummary(input.allianceId, input.poolType);
  if (summary.total === 0) {
    return false;
  }

  const unselected = await listUnselectedPoolEntries(
    input.allianceId,
    input.poolType,
  );
  if (unselected.length === 0) {
    return false;
  }

  const eligibility =
    input.claimEligibility ??
    (await resolveDepletingPoolClaimEligibility({
      allianceId: input.allianceId,
      poolType: input.poolType,
      date: input.date,
      respectConductorMinimums: input.respectConductorMinimums,
      memberIds: unselected.map((row) => row.memberId),
    }));

  return applyDepletingPoolClaimEligibility(unselected, eligibility).length > 0;
}

/** Seed a conductor pool if it has no entries yet (used by rolls and manual picks). */
export async function ensureConductorPoolSeeded(input: {
  hqAllianceId: string;
  poolType: PoolType;
  date: string;
  useSequence: boolean;
  eventTopN?: number;
  rule?: ConductorRule | null;
  respectConductorMinimums?: boolean;
  /** Precomputed claim filters — avoids a duplicate Ashed/rank fetch on roll. */
  claimEligibility?: DepletingPoolClaimEligibility;
}): Promise<void> {
  const respectConductorMinimums =
    input.respectConductorMinimums ??
    (await resolvePoolRespectsConductorMinimums({
      allianceId: input.hqAllianceId,
      poolType: input.poolType,
      rule: input.rule,
    }));

  const hasViable = await poolHasViableUnselectedEntries({
    allianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    respectConductorMinimums,
    claimEligibility: input.claimEligibility,
  });
  if (hasViable) {
    return;
  }

  const summary = await getPoolSummary(input.hqAllianceId, input.poolType);
  // Mid-generation leftovers that fail conductor minimums must not trigger a
  // reseed — that re-admits already-selected winners into a new generation.
  // rollFromPool throws POOL_UNAVAILABLE when none of the leftovers qualify.
  if (summary.total > 0 && !summary.exhausted) {
    return;
  }

  const candidates = await buildPoolCandidates({
    hqAllianceId: input.hqAllianceId,
    poolType: input.poolType,
    date: input.date,
    eventTopN: input.eventTopN,
    rule: input.rule,
    respectConductorMinimums,
  });
  if (candidates.length === 0) {
    throwPoolEmpty(input.poolType);
  }

  if (summary.total > 0) {
    await startNewPoolGeneration(input.hqAllianceId, input.poolType, candidates);
    return;
  }

  await seedPool(input.hqAllianceId, input.poolType, candidates);
}

async function rollFromPool(
  allianceId: string,
  poolType: PoolType,
  date: string,
  useSequence: boolean,
  mechanism: ConductorMechanismType | VipMechanismType,
  useWeightedPick = false,
  respectConductorMinimums = false,
  dayExcludedMemberIds?: ReadonlySet<string>,
  claimEligibility?: DepletingPoolClaimEligibility,
  options?: { skipClaimLock?: boolean },
): Promise<RollResult> {
  // Ashed VS + roster rank filters run once outside the claim lock. Holding
  // the lock across those fetches is what stacked swap→spin cycles into 504s
  // (next spin blocked on pg_advisory_lock until the gateway gave up).
  const unselectedSnapshot = await listUnselectedPoolEntries(
    allianceId,
    poolType,
  );
  const eligibility =
    claimEligibility ??
    (await resolveDepletingPoolClaimEligibility({
      allianceId,
      poolType,
      date,
      respectConductorMinimums,
      memberIds: unselectedSnapshot.map((row) => row.memberId),
    }));

  // Serialize list→pick→claim so parallel spins for different dates cannot
  // both mark the same pool row. Conditional claim + retry is defense in depth
  // if a manual pick races outside this lock.
  // VIP assign may call with skipClaimLock so claim+VIP persist share one lock.
  const claim = async (): Promise<RollResult> => {
    const summary = await getPoolSummary(allianceId, poolType);
    const maxAttempts = Math.max(summary.remaining, 1) + 2;

    let entry: Awaited<
      ReturnType<typeof listUnselectedPoolEntries>
    >[number] | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { awayMemberIds } = await loadTimeOffAvailability(allianceId, date);
      let unselected = applyDepletingPoolClaimEligibility(
        await listUnselectedPoolEntries(allianceId, poolType),
        eligibility,
      ).filter((row) => !awayMemberIds.has(row.memberId));

      if (dayExcludedMemberIds && dayExcludedMemberIds.size > 0) {
        unselected = filterDaySpinCandidates(unselected, dayExcludedMemberIds);
      }

      let candidate: (typeof unselected)[number] | null = null;
      if (unselected.length > 0) {
        if (useSequence) {
          candidate =
            [...unselected].sort(
              (a, b) => (a.sequencePosition ?? 0) - (b.sequencePosition ?? 0),
            )[0] ?? null;
        } else if (useWeightedPick) {
          candidate = pickWeightedPoolEntryFromRows(unselected);
        } else {
          candidate = pickUniformPoolEntry(unselected);
        }
      }

      if (!candidate) {
        break;
      }

      const claimed = await markPoolEntrySelected(candidate.id, date);
      if (claimed) {
        entry = candidate;
        break;
      }
      // Lost the race to another claim — re-list and try the next eligible row.
    }

    if (!entry && summary.exhausted) {
      throwPoolExhausted(poolType);
    }

    if (!entry) {
      throwPoolUnavailable(poolType);
    }

    const { awayMemberIds } = await loadTimeOffAvailability(allianceId, date);
    const generationEntries = await listPoolEntries(allianceId, poolType);
    const reelMemberIds =
      eligibility.minimumsQualifiedIds ??
      generationEntries.map((row) => row.memberId);
    const reelAllowed = new Set(reelMemberIds);
    const dayExcluded = dayExcludedMemberIds ?? new Set<string>();
    const seenMemberIds = new Set<string>();
    const wheelCandidates = generationEntries.flatMap((row) => {
      if (!reelAllowed.has(row.memberId) || awayMemberIds.has(row.memberId)) return [];
      if (dayExcluded.has(row.memberId)) return [];
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
  };

  if (options?.skipClaimLock) {
    return claim();
  }
  return withConductorPoolClaimLock({ allianceId, poolType }, claim);
}

async function applyConductorQualificationGate(input: {
  allianceId: string;
  date: string;
  result: RollResult;
  rule?: ConductorRule | null;
  leadDays?: number;
}): Promise<RollResult> {
  const qualification = await evaluateConductorQualification({
    allianceId: input.allianceId,
    memberId: input.result.memberId,
    trainDate: input.date,
    rule: input.rule,
    leadDays: input.leadDays,
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

async function recheckAutomaticDutyAvailability(input: {
  allianceId: string;
  date: string;
  result: RollResult;
}): Promise<void> {
  const { awayMemberIds } = await loadTimeOffAvailability(input.allianceId, input.date);
  if (!awayMemberIds.has(input.result.memberId)) return;
  if (input.result.poolType) {
    await releasePoolSelectionForDate(input.allianceId, input.date, input.result.memberId);
    throwPoolUnavailable(input.result.poolType);
  }
  throwPoolUnavailable();
}

async function persistConductorRoll(input: {
  allianceId: string;
  date: string;
  seasonKey: string;
  result: RollResult;
  mechanism: ConductorMechanismType;
  dayConfigId: string | null;
  /** Rules snapshotted onto the record alongside the legacy mechanisms. */
  conductorRule?: ConductorRule | null;
  vipRule?: VipRule | null;
  manualCoverageOverride?: boolean;
}): Promise<RollResult> {
  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    input.result.memberId,
    input.date,
  );

  if (!input.manualCoverageOverride) await recheckAutomaticDutyAvailability(input);
  await upsertConductorDraft({
    poolClaim: input.manualCoverageOverride ? input.result.poolType : undefined,
    automaticDuty: !input.manualCoverageOverride,
    allianceId: input.allianceId,
    date: input.date,
    seasonKey: input.seasonKey,
    conductorMemberId: input.result.memberId,
    conductorMemberName: input.result.memberName,
    conductorRankEventId: rankEvent?.id ?? null,
    conductorMechanism: input.mechanism,
    vipMechanism: encodeLegacyVipMechanism(
      input.vipRule ?? null,
    ) as VipMechanismType,
    conductorRule: input.conductorRule ?? null,
    vipRule: input.vipRule ?? null,
    dayConfigId: input.dayConfigId,
    conductorEligibilityOverridden: 0,
    conductorEligibilityOverriddenAt: null,
    conductorEligibilityOverriddenByHqUserId: null,
  }).catch(async (error) => {
    if (!input.manualCoverageOverride && input.result.poolType) await releasePoolSelectionForDate(input.allianceId, input.date, input.result.memberId);
    if (!input.manualCoverageOverride && error instanceof CoverageConflictError) throwPoolUnavailable(input.result.poolType);
    throw error;
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
  const leadDays = await loadAllianceTrainLeadTimeDays(input.allianceId);

  const qualification = assertConductorMinimumOverrideQualification(
    await evaluateConductorQualification({
      allianceId: input.allianceId,
      memberId: input.memberId,
      trainDate: input.date,
      rule: dayConfig.conductorRule,
      leadDays,
    }),
  );

  const poolType = conductorRulePoolType(dayConfig.conductorRule);
  const result: RollResult = {
    memberId: input.memberId,
    memberName: input.memberName,
    mechanism: input.mechanism,
    isAutomatic: false,
    poolType: poolType ?? undefined,
    qualification,
  };

  const persisted = await persistConductorRoll({
    manualCoverageOverride: true,
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    result,
    mechanism: input.mechanism,
    dayConfigId: dayConfig.dayConfigId,
    vipRule: dayConfig.vipRule,
    conductorRule: dayConfig.conductorRule,
  });

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId ?? undefined,
    action: "trains.conductor_minimum_override",
    severity: "override",
    resourceType: "train_conductor_record",
    resourceId: `${input.allianceId}:${input.date}`,
    resourceName: input.memberName,
    metadata: {
      permission: "trains:write",
      date: input.date,
      memberId: input.memberId,
      mechanism: input.mechanism,
      overrideReason: input.overrideReason?.trim() || null,
      qualification,
      source: "manual",
    },
  });

  return persisted;
}

export async function getOrCreateWeekSchedule(
  allianceId: string,
  weekStart: string,
  templateId: string | null = null,
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
      templateId,
      seasonKey,
    });
    if (templateId) {
      await replaceDayConfigs(
        allianceId,
        schedule.id,
        weekDayConfigsForTemplate(
          await loadWeekFillTemplateById(templateId),
          weekStart,
        ),
      );
    }
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
  templateId: string,
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
    templateId,
    seasonKey,
    isPivot,
  });
  const configs = weekDayConfigsForTemplate(
    await loadWeekFillTemplateById(templateId),
    weekStart,
  );
  const configsToApply = preserveThroughDate
    ? configs.filter((config) => config.date > preserveThroughDate)
    : configs;

  if (configsToApply.length > 0) {
    await replaceDayConfigs(allianceId, schedule.id, configsToApply);
  }
}

/**
 * Ensure a `train_week_schedules` row exists before day-level mutations.
 * Does not bulk-seed day configs — single-day paints upsert overrides only.
 */
export async function ensureWeekScheduleBaseline(
  allianceId: string,
  weekStart: string,
  preferredTemplateId?: string | null,
): Promise<(typeof import("@/lib/db/schema").trainWeekSchedules.$inferSelect)> {
  const seasonKey = await resolveTrainSeasonKey(allianceId);
  let schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  if (!schedule) {
    // No template is a valid state: painting one day should not silently
    // declare a preset for the other six.
    schedule = await upsertWeekSchedule({
      allianceId,
      weekStart,
      templateId: preferredTemplateId ?? null,
      seasonKey,
    });
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
  const vsPushWeek = await getRuleTemplateByPresetKey("vs_push_week");
  if (!schedule || !vsPushWeek || schedule.templateId !== vsPushWeek.id) {
    return;
  }

  const weekEnd = addCalendarDays(weekStart, 6);
  const configs = await listDayConfigsForWeek(allianceId, weekStart, weekEnd);
  const hasEconomyOverride = configs.some((config) => {
    if (config.isOverride !== 1) return false;
    const idx = weekDatesFromMonday(weekStart).indexOf(config.date);
    const rule = parseConductorRule(config.conductorRule);
    return idx >= 1 && rule?.kind === "rank_pool" && rule.pool === "r3";
  });

  if ((schedule.isPivot === 1) === hasEconomyOverride) {
    return;
  }

  await upsertWeekSchedule({
    allianceId,
    weekStart,
    templateId: schedule.templateId,
    seasonKey,
    isPivot: hasEconomyOverride,
  });
}

/**
 * The one paint command.
 *
 * Every surface — guided picker, long-press menu, month toolbar, hotkeys,
 * week editor — funnels here. `conductorRule` and `vipRule` are independent
 * patches: an omitted side preserves the day's current rule, `null` is a
 * deliberate clear (free choice / conductor's pick). A scoped board can no
 * longer arrive half-specified (the cause of both the 400 on Apply and the
 * silent Top 5 → Top 10 reset from hotkeys), and there is no composite
 * expansion to get wrong: a week is seven of these.
 */
export async function applyPaint(
  allianceId: string,
  input: {
    dates: string[];
    conductorRule?: ConductorRule | null;
    vipRule?: VipRule | null;
    /** Template this paint came from, for provenance. */
    sourceTemplateId?: string | null;
  },
  options?: {
    platformAdminPastOverride?: boolean;
    /** Persist the week schedule's preset (week template dropdown). */
    updateWeekTemplate?: string | null;
    /** Preset to persist when materializing a draft week on first paint. */
    preferredWeekTemplate?: string | null;
  },
): Promise<void> {
  if (input.dates.length === 0) return;
  if (input.conductorRule === undefined && input.vipRule === undefined) return;

  const seasonKey = await resolveTrainSeasonKey(allianceId);
  const trainWeekConfig = await loadAllianceTrainWeekConfig(allianceId);
  const uniqueDates = [...new Set(input.dates)].sort();
  const today = getServerCalendarDate();
  const isPlatformAdmin = options?.platformAdminPastOverride ?? false;

  if (input.conductorRule?.kind === "vr_top_n") {
    const reporterCount = await countAllianceVrReporters(allianceId);
    if (!isVrTopScopeUnlocked(input.conductorRule.topN, reporterCount)) {
      throw new Error(
        `Need ${2 * input.conductorRule.topN} VR reports for Top ${input.conductorRule.topN} (have ${reporterCount}).`,
      );
    }
  }

  for (const date of uniqueDates) {
    assertTemplateChangeAllowed(date, isPlatformAdmin, today);
  }

  const weekStarts = [
    ...new Set(uniqueDates.map((d) => getTrainWeekStart(d, trainWeekConfig))),
  ];
  for (const weekStart of weekStarts) {
    await ensureWeekScheduleBaseline(
      allianceId,
      weekStart,
      options?.preferredWeekTemplate,
    );
  }

  const activeMemberIds = new Set(
    input.conductorRule === undefined
      ? []
      : (await loadActiveAlliancePoolMembers({ allianceId })).map(
          (member) => member.ashedMemberId,
        ),
  );

  for (const date of uniqueDates) {
    const weekStart = getTrainWeekStart(date, trainWeekConfig);
    const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
    if (!schedule) continue;

    const previousDayConfig = await resolveRollDayConfig(
      allianceId,
      date,
      seasonKey,
    );
    const mergedRules = mergeDayRulePatch(
      {
        conductorRule: previousDayConfig.conductorRule,
        vipRule: previousDayConfig.vipRule,
      },
      input,
    );

    const paintedConfig: DayConfigInput = {
      date,
      conductorRule: mergedRules.conductorRule,
      vipRule: mergedRules.vipRule,
      sourceTemplateId: input.sourceTemplateId ?? null,
    };
    await upsertDayConfigOverride(allianceId, schedule.id, paintedConfig, true);

    const conductorChanged = conductorRuleChanged(
      previousDayConfig.conductorRule,
      mergedRules.conductorRule,
    );

    if (!conductorChanged) {
      if (
        vipRuleIdentity(previousDayConfig.vipRule) !==
        vipRuleIdentity(mergedRules.vipRule)
      ) {
        const record = await getConductorRecord(allianceId, date, seasonKey);
        if (record) {
          await restampConductorRules({
            allianceId,
            date,
            seasonKey,
            conductorRule: mergedRules.conductorRule,
            vipRule: mergedRules.vipRule,
          });
        }
      }
      continue;
    }

    const record = await getConductorRecord(allianceId, date, seasonKey);
    if (record?.conductorMemberId) {
      const resolved = await resolveMemberAllianceRankAsOf(
        allianceId,
        record.conductorMemberId,
        date,
      );
      const keep = shouldKeepAssignedConductorOnPaint({
        ruleChanged: true,
        memberId: record.conductorMemberId,
        onRoster: activeMemberIds.has(record.conductorMemberId),
        allianceRank: resolved.rank,
        nextRule: mergedRules.conductorRule,
      });
      if (keep) {
        await restampConductorRules({
          allianceId,
          date,
          seasonKey,
          conductorRule: mergedRules.conductorRule,
          vipRule: mergedRules.vipRule,
        });
      } else if (record.lockedAt) {
        throw new LockedDayPaintBlockedError(date, record.conductorMemberName);
      } else {
        await clearConductorAssignment(allianceId, date, seasonKey);
        if (record.vipMemberId) {
          await clearVipAssignment(allianceId, date, seasonKey);
        }
      }
    } else if (record && !record.lockedAt && record.vipMemberId) {
      await clearVipAssignment(allianceId, date, seasonKey);
    }
  }

  const nextWeekTemplate = options?.updateWeekTemplate;
  for (const weekStart of weekStarts) {
    if (nextWeekTemplate) {
      const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
      if (schedule) {
        await upsertWeekSchedule({
          allianceId,
          weekStart,
          templateId: nextWeekTemplate,
          seasonKey,
          isPivot: schedule.isPivot === 1,
        });
      }
    }
    await recomputeWeekPivotFlag(allianceId, weekStart);
  }
}

/** Apply a whole template to a week: seven independent day paints. */
export async function applyTemplateToWeek(
  allianceId: string,
  weekStart: string,
  templateId: string,
  options?: { platformAdminPastOverride?: boolean; isPivot?: boolean },
): Promise<void> {
  const template = await loadWeekFillTemplateById(templateId);
  const today = getServerCalendarDate();
  const canPaintPast = options?.platformAdminPastOverride === true;
  for (const config of weekDayConfigsForTemplate(template, weekStart)) {
    if (!canPaintPast && !canOfficerChangeTemplateForDate(config.date, today)) {
      continue;
    }
    await applyPaint(
      allianceId,
      {
        dates: [config.date],
        conductorRule: config.conductorRule,
        vipRule: config.vipRule,
        sourceTemplateId: templateId,
      },
      {
        platformAdminPastOverride: options?.platformAdminPastOverride,
        updateWeekTemplate: templateId,
        preferredWeekTemplate: templateId,
      },
    );
  }

  if (options?.isPivot !== undefined) {
    const seasonKey = await resolveTrainSeasonKey(allianceId);
    await upsertWeekSchedule({
      allianceId,
      weekStart,
      templateId,
      seasonKey,
      isPivot: options.isPivot,
    });
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

  const leadDays = await loadAllianceTrainLeadTimeDays(input.allianceId);
  const rule = effectiveConductorRuleForTrainDate({
    trainRule: dayConfig.conductorRule,
  });
  const mechanism = encodeLegacyConductorMechanism(rule) as ConductorMechanismType;
  const topBoard = resolveVsBoardForTrainDate({
    trainRule: dayConfig.conductorRule,
  });

  let result: RollResult;
  /** Pool claim already applied conductor minimums — skip post-roll Ashed DQ. */
  let poolRollEnforcedMinimums = false;
  const applyDaySpinExclusion = usesDaySpinExclusions({ rule });
  const dayExcluded = applyDaySpinExclusion
    ? buildDaySpinExclusionSet({
        storedMemberIds: await listDaySpinExcludedMemberIds(
          input.allianceId,
          input.date,
        ),
        currentDraftMemberId: record?.conductorMemberId,
      })
    : new Set<string>();

  if (topBoard) {
    const scoreDate = vsScoreReferenceDate(input.date, leadDays);
    const top = await fetchVsTopScorersForTrainDateResolved({
      hqAllianceId: input.allianceId,
      trainDate: input.date,
      limit: topBoard.topN,
      leadDays,
    });
    if (top.length === 0) {
      throwNoWheelCandidates("vs", "No VS scores found for the wheel.", {
        scoreDate,
        leadDays,
      });
    }
    const { awayMemberIds } = await loadTimeOffAvailability(input.allianceId, input.date);
    const available = top.filter((candidate) => !awayMemberIds.has(candidate.memberId));
    if (available.length === 0) throwPoolUnavailable();
    if (topBoard.topN === 1) {
      const winner = available[0]!;
      result = {
        ...winner,
        mechanism,
        isAutomatic: true,
      };
    } else {
      const eligible = filterDaySpinCandidates(available, dayExcluded);
      if (eligible.length === 0) {
        throwNoWheelCandidates(
          "vs",
          "Everyone in today's Top VS board was already drawn. Try again tomorrow or pick manually.",
        );
      }
      const winner = eligible[Math.floor(Math.random() * eligible.length)]!;
      result = {
        ...winner,
        mechanism,
        isAutomatic: false,
        wheelCandidates: eligible,
      };
    }
  } else if (rule?.kind === "vr_top_n") {
    const vrTopN = rule.topN;
    const reporterCount = await countAllianceVrReporters(input.allianceId);
    if (!isVrTopScopeUnlocked(vrTopN, reporterCount)) {
      throw new Error(
        `Need ${2 * vrTopN} VR reports for Top ${vrTopN} (have ${reporterCount}).`,
      );
    }
    const top = await fetchNativeVrTopScorers(input.allianceId, vrTopN);
    // Fail closed if the board is short of scope N (stale paint / roster churn
    // between unlock count and roll). Do not draw Top N from fewer candidates.
    if (top.length === 0) {
      throwNoWheelCandidates("vr", "No VR standings found for the wheel.");
    }
    if (top.length < vrTopN) {
      throwNoWheelCandidates(
        "vr",
        `Only ${top.length} of ${vrTopN} active-roster VR standings available for Top ${vrTopN}.`,
      );
    }
    const { awayMemberIds } = await loadTimeOffAvailability(input.allianceId, input.date);
    const available = top.filter((candidate) => !awayMemberIds.has(candidate.memberId));
    if (available.length === 0) throwPoolUnavailable();
    const eligible = filterDaySpinCandidates(available, dayExcluded);
    if (eligible.length === 0) {
      throwNoWheelCandidates(
        "vr",
        "Everyone in today's Top VR board was already drawn. Try again tomorrow or pick manually.",
      );
    }
    const winner = eligible[Math.floor(Math.random() * eligible.length)]!;
    result = {
      ...winner,
      mechanism,
      isAutomatic: false,
      wheelCandidates: eligible,
    };
  } else if (rule?.kind === "donations_top") {
    throwNoWheelCandidates(
      "donation",
      "Donation wheels require a manual conductor pick — HQ does not store donation scores yet.",
    );
    throw new Error("unreachable");
  } else if (rule?.kind === "price_is_freight") {
    result = await rollPriceIsFreightConductor({
      allianceId: input.allianceId,
      date: input.date,
      rule,
      excludedMemberIds: dayExcluded,
    });
  } else if (rule?.kind === "rank_pool" || rule?.kind === "event_top_x") {
      if (rule.kind === "rank_pool" && rule.draw === "manual") {
        throw new Error(
          "R3 recognition conductors are awarded by manual pick, not the wheel.",
        );
      }

      const poolType = conductorRulePoolType(rule)!;
      const useSequence = rule.kind === "rank_pool" && rule.pool === "r4_plus";
      const respectConductorMinimums =
        await resolvePoolRespectsConductorMinimums({
          allianceId: input.allianceId,
          poolType,
          rule,
        });
      // One Ashed + rank pass shared by seed check and claim (not under lock).
      const unselectedForEligibility = await listUnselectedPoolEntries(
        input.allianceId,
        poolType,
      );
      let claimEligibility = await resolveDepletingPoolClaimEligibility({
        allianceId: input.allianceId,
        poolType,
        date: input.date,
        respectConductorMinimums,
        memberIds: unselectedForEligibility.map((row) => row.memberId),
      });
      const hadViableBeforeSeed =
        applyDepletingPoolClaimEligibility(
          unselectedForEligibility,
          claimEligibility,
        ).length > 0;
      await ensureConductorPoolSeeded({
        hqAllianceId: input.allianceId,
        poolType,
        date: input.date,
        useSequence,
        rule,
        respectConductorMinimums,
        claimEligibility,
      });
      // Reseed/new generation changes the unselected set — refresh filters.
      if (!hadViableBeforeSeed) {
        const refreshedUnselected = await listUnselectedPoolEntries(
          input.allianceId,
          poolType,
        );
        claimEligibility = await resolveDepletingPoolClaimEligibility({
          allianceId: input.allianceId,
          poolType,
          date: input.date,
          respectConductorMinimums,
          memberIds: refreshedUnselected.map((row) => row.memberId),
        });
      }
      const useWeightedPick = false;
      // Do not release the prior depleting selection before claiming the next
      // winner. A failed re-roll (empty pool / qualification miss) must leave
      // the draft conductor's pool slot consumed.
      result = await rollFromPool(
        input.allianceId,
        poolType,
        input.date,
        useSequence,
        mechanism,
        useWeightedPick,
        respectConductorMinimums,
        applyDaySpinExclusion ? dayExcluded : undefined,
        claimEligibility,
      );
      poolRollEnforcedMinimums = respectConductorMinimums;
  } else {
    throw new Error("This day has no conductor rule to spin — pick manually.");
  }

  const gateApplies =
    !poolRollEnforcedMinimums &&
    (await resolveConductorQualificationGateApplies({
      allianceId: input.allianceId,
      poolType: result.poolType ?? conductorRulePoolType(rule) ?? null,
      rule,
    }));

  const gated = gateApplies
    ? await applyConductorQualificationGate({
        allianceId: input.allianceId,
        date: input.date,
        result,
        rule,
        leadDays,
      })
    : { ...result, draftPersisted: true };

  if (gated.draftPersisted) {
    await persistConductorRoll({
      allianceId: input.allianceId,
      date: input.date,
      seasonKey,
      result: gated,
      mechanism,
      dayConfigId: dayConfig.dayConfigId,
      vipRule: dayConfig.vipRule,
      conductorRule: rule,
    });
  } else {
    await recheckAutomaticDutyAvailability({ ...input, result: gated });
  }

  // Record drawn winners for non-deterministic spins even when qualification
  // rejects the draft — a re-spin means that member is unavailable today.
  if (applyDaySpinExclusion) {
    await recordDaySpinExclusion({
      allianceId: input.allianceId,
      date: input.date,
      memberId: gated.memberId,
      memberName: gated.memberName,
    });
  }

  if (!gated.draftPersisted) {
    return gated;
  }

  const poolRefreshed = gated.poolType
    ? await refreshExhaustedPoolIfNeeded({
        allianceId: input.allianceId,
        poolType: gated.poolType,
        date: input.date,
        rule,
      })
    : null;
  const persisted = poolRefreshed ? { ...gated, poolRefreshed } : gated;

  if (
    shouldReleasePriorPoolSelection({
      previousMemberId: record?.conductorMemberId,
      nextMemberId: gated.memberId,
    })
  ) {
    await releasePoolSelectionForDate(
      input.allianceId,
      input.date,
      record!.conductorMemberId!,
    );
  }

  return persisted;
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
  if (!record?.lockedAt) {
    throw new Error("Lock the conductor before assigning VIP.");
  }
  if (!record.conductorMemberId) {
    throw new Error("No conductor set for this day.");
  }

  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    seasonKey,
  );

  const vipRule = dayConfig.vipRule;
  if (!vipRule || vipRule.kind === "none") {
    throw new Error("VIP is chosen by the conductor today, not by wheel.");
  }
  const mechanism = encodeLegacyVipMechanism(vipRule) as VipMechanismType;

  let result: RollResult;

  switch (vipRule.kind) {
    case "donations_second": {
      throwNoWheelCandidates(
        "donation",
        "Donation wheels require a manual VIP pick — HQ does not store donation scores yet.",
      );
    }
    case "event_top_x": {
      const config: EventTopXConfig = {
        eventKey: vipRule.eventKey,
        topN: vipRule.topN,
      };
      const poolType: PoolType = "event_top_x";
      // Keep the prior VIP depleting selection until the replacement wins and
      // is persisted — a failed re-roll must not free the current VIP slot.
      await ensureConductorPoolSeeded({
        hqAllianceId: input.allianceId,
        poolType,
        date: input.date,
        useSequence: false,
        eventTopN: config.topN ?? 10,
      });
      // Hold the pool claim lock through VIP assign + prior release. Claiming
      // then unlocking before assign orphaned winners when assign failed or a
      // concurrent VIP spin overwrote the record (burned pool slots).
      result = await withConductorPoolClaimLock(
        { allianceId: input.allianceId, poolType },
        async () => {
          const rolled = await rollFromPool(
            input.allianceId,
            poolType,
            input.date,
            false,
            mechanism,
            false,
            false,
            undefined,
            undefined,
            { skipClaimLock: true },
          );

          const rankEvent = await getMemberRankAsOf(
            input.allianceId,
            rolled.memberId,
            input.date,
          );

          try {
            await recheckAutomaticDutyAvailability({
              allianceId: input.allianceId,
              date: input.date,
              result: rolled,
            });
            await assignVipOnLockedConductor({
              automaticDuty: true,
              allianceId: input.allianceId,
              date: input.date,
              seasonKey,
              vipMemberId: rolled.memberId,
              vipMemberName: rolled.memberName,
              vipRankEventId: rankEvent?.id ?? null,
              vipMechanism: mechanism,
              dayConfigId: dayConfig.dayConfigId,
            });
          } catch (error) {
            await releasePoolSelectionForDate(
              input.allianceId,
              input.date,
              rolled.memberId,
            );
            if (error instanceof CoverageConflictError) throwPoolUnavailable(poolType);
            throw error;
          }

          if (
            shouldReleasePriorPoolSelection({
              previousMemberId: record?.vipMemberId,
              nextMemberId: rolled.memberId,
            })
          ) {
            await releasePoolSelectionForDate(
              input.allianceId,
              input.date,
              record!.vipMemberId!,
            );
          }

          return rolled;
        },
      );
      break;
    }
    default:
      throw new Error(`VIP mechanism "${mechanism}" is not rollable yet.`);
  }

  await recheckAutomaticDutyAvailability({ ...input, result });
  const poolRefreshed = result.poolType
    ? await refreshExhaustedPoolIfNeeded({
        allianceId: input.allianceId,
        poolType: result.poolType,
        date: input.date,
        eventTopN:
          dayConfig.vipRule?.kind === "event_top_x"
            ? dayConfig.vipRule.topN
            : 10,
      })
    : null;
  return poolRefreshed ? { ...result, poolRefreshed } : result;
}

export async function reseedPool(input: {
  allianceId: string;
  poolType: PoolType;
  date: string;
  useSequence?: boolean;
  eventTopN?: number;
  rule?: ConductorRule | null;
  respectConductorMinimums?: boolean;
}): Promise<{ generation: number; count: number }> {
  const respectConductorMinimums =
    input.respectConductorMinimums ??
    (await resolvePoolRespectsConductorMinimums({
      allianceId: input.allianceId,
      poolType: input.poolType,
      rule: input.rule,
    }));
  const candidates = await buildPoolCandidates({
    hqAllianceId: input.allianceId,
    poolType: input.poolType,
    date: input.date,
    eventTopN: input.eventTopN,
    rule: input.rule,
    respectConductorMinimums,
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

  const conductorPool = conductorRulePoolType(dayConfig.conductorRule);
  if (conductorPool) {
    const next = await refreshExhaustedPoolIfNeeded({
      ...base,
      poolType: conductorPool,
      rule: dayConfig.conductorRule,
    });
    if (next) refreshed.push(next);
  }

  const vipPool = vipRulePoolType(dayConfig.vipRule);
  if (vipPool) {
    const vipConfig: EventTopXConfig =
      dayConfig.vipRule?.kind === "event_top_x"
        ? { eventKey: dayConfig.vipRule.eventKey, topN: dayConfig.vipRule.topN }
        : { eventKey: "capitol_war", topN: 10 };
    const next = await refreshExhaustedPoolIfNeeded({
      ...base,
      poolType: vipPool,
      eventTopN: vipConfig.topN ?? 10,
    });
    if (next) refreshed.push(next);
  }

  return refreshed;
}

export type ConductorHistoryImportRowInput = {
  date: string;
  memberId: string;
  memberName: string;
};

export type ConductorHistoryImportRowResult = {
  date: string;
  status: "imported" | "skipped" | "conflict" | "error";
  message?: string;
};

/**
 * Backfill past locked conductors from a reviewed import.
 * Does not announce to Discord and does not mutate depleting pools — import
 * has no reliable historical mechanism (VS Push vs Economy Week, etc.).
 */
export async function importConductorHistory(input: {
  allianceId: string;
  rows: ConductorHistoryImportRowInput[];
  lockedByHqUserId?: string | null;
}): Promise<{
  imported: number;
  skipped: number;
  conflicts: number;
  results: ConductorHistoryImportRowResult[];
}> {
  const today = getServerCalendarDate();
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const { loadAllianceGameRoster } = await import("@/lib/members/game-roster");
  const roster = await loadAllianceGameRoster({ allianceId: input.allianceId });
  const rosterById = new Map(roster.map((member) => [member.id, member]));

  const results: ConductorHistoryImportRowResult[] = [];
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;

  // Newest→oldest paste is fine; process oldest→newest so train spawn order is stable.
  const sorted = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));

  for (const row of sorted) {
    const date = row.date.trim();
    const memberId = row.memberId.trim();
    const memberName = row.memberName.trim();

    if (!date || !memberId || !memberName) {
      results.push({
        date,
        status: "error",
        message: "date, memberId, and memberName are required.",
      });
      continue;
    }

    if (date >= today) {
      results.push({
        date,
        status: "error",
        message: "Import is limited to past days.",
      });
      continue;
    }

    if (!rosterById.has(memberId)) {
      results.push({
        date,
        status: "error",
        message: "Member is not on the alliance roster.",
      });
      continue;
    }

    try {
      const existing = await getConductorRecord(
        input.allianceId,
        date,
        seasonKey,
      );

      if (existing?.lockedAt) {
        if (existing.conductorMemberId === memberId) {
          skipped += 1;
          results.push({ date, status: "skipped" });
          continue;
        }
        conflicts += 1;
        results.push({
          date,
          status: "conflict",
          message: existing.conductorMemberName
            ? `Locked to ${existing.conductorMemberName}.`
            : "Locked to a different conductor.",
        });
        continue;
      }

      const rankEvent = await getMemberRankAsOf(
        input.allianceId,
        memberId,
        date,
      );
      const draft = existing?.conductorMemberId === memberId ? existing : await upsertConductorDraft({
        allianceId: input.allianceId,
        date,
        seasonKey,
        conductorMemberId: memberId,
        conductorMemberName: memberName,
        conductorRankEventId: rankEvent?.id ?? null,
      });
      await lockConductorRecord(
        draft.id,
        input.allianceId,
        input.lockedByHqUserId,
      );
      imported += 1;
      results.push({ date, status: "imported" });
    } catch (error) {
      results.push({
        date,
        status: "error",
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  return { imported, skipped, conflicts, results };
}

export async function listConductorSnapshotsForDateRange(input: {
  allianceId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<
  Array<{
    date: string;
    conductorMemberId: string | null;
    conductorMemberName: string | null;
    lockedAt: string | null;
  }>
> {
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const rows = await listConductorRecordsInRange(
    input.allianceId,
    input.rangeStart,
    input.rangeEnd,
    seasonKey,
  );
  return rows.map((row) => ({
    date: row.date,
    conductorMemberId: row.conductorMemberId,
    conductorMemberName: row.conductorMemberName,
    lockedAt: row.lockedAt?.toISOString() ?? null,
  }));
}

export async function lockConductorsForDates(input: {
  allianceId: string;
  dates: string[];
  lockedByHqUserId?: string | null;
}): Promise<{
  records: Awaited<ReturnType<typeof lockConductorRecord>>[];
  poolsRefreshed: PoolRefreshedInfo[];
}> {
  const seasonKey = await resolveTrainSeasonKey(input.allianceId);
  const uniqueDates = [...new Set(input.dates)].sort();
  const pendingRecordIds: string[] = [];
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

    const leadTime = await loadAllianceTrainLeadTimeSettings(
      input.allianceId,
      false,
    );
    if (
      conductorLockBlockedByPendingConfirmation(
        leadTime.trainConductorConfirmationEnabled,
        record.conductorNominationStatus,
      )
    ) {
      throw new Error(
        `Confirm the nominated conductor for ${date} before locking.`,
      );
    }

    pendingRecordIds.push(record.id);
  }
  const { lockConductorsWithBoarding } = await import("./boarding.server");
  const records = await lockConductorsWithBoarding(pendingRecordIds, input.allianceId, input.lockedByHqUserId);
  for (const locked of records) {
    const date = locked.date;
    await syncDepletingPoolSelectionForConductorDay({
      allianceId: input.allianceId,
      date,
      seasonKey,
      memberId: locked.conductorMemberId,
    });
    const refreshed = await refreshExhaustedPoolsForDay({
      allianceId: input.allianceId,
      date,
      seasonKey,
    });
    poolsRefreshed.push(...refreshed);
  }

  return { records, poolsRefreshed };
}

/**
 * Stamp (or refresh) depleting-pool selection for a day's conductor when the
 * day uses a depleting mechanism. No-op for TPIF with-replacement / non-pool days.
 */
export async function syncDepletingPoolSelectionForConductorDay(input: {
  allianceId: string;
  date: string;
  seasonKey: string;
  memberId: string | null | undefined;
}): Promise<void> {
  if (!input.memberId) return;
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.date,
    input.seasonKey,
  );
  if (conductorRuleUsesPriceIsFreightRoll(dayConfig.conductorRule)) return;
  const poolType = conductorRulePoolType(dayConfig.conductorRule);
  if (!poolType) return;
  await markPoolMemberSelectedForDate(
    input.allianceId,
    poolType,
    input.memberId,
    input.date,
  );
}

export { swapConductorDrafts as swapConductors } from "./swap-coverage.server";

export { getServerCalendarDate };
export { getWeekStartMonday } from "@/lib/trains/game-time";
