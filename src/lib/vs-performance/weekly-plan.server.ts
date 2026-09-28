import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { vsScope, assertVsScope, vsContextScope, assertVsActorCurrent } from "@/lib/vs-performance/vs-scope.server";

import { getDb, schema } from "@/lib/db";
import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { loadSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";
import { lockAllianceAvailability, type AvailabilityTransaction } from "@/lib/time-off/availability.server";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { getConductorRecord, type TrainsDb } from "@/lib/trains/repository";
import {
  getServerCalendarDate,
} from "@/lib/trains/game-time";
import { scheduleWeekStart } from "@/lib/trains/train-week-calendar.shared";
import { conductorRuleChanged } from "@/lib/trains/conductor-mechanism.shared";
import type { ConductorRule, VipRule } from "@/lib/trains/rules/catalog.shared";
import {
  commitTrainPaints,
  ensureWeekScheduleBaseline,
  loadTrainPaintInputs,
  lockAllianceTrainSettings,
  prepareTrainPaints,
  resolveTrainSeasonKey,
  type PreparedTrainPaint,
  type TrainPaintInputs,
  type TrainPaintPatch,
} from "@/lib/trains/service";
import { calculateVsWeekPoints } from "@/lib/vs-performance/match-results.shared";
import {
  compareVsMemberScores,
  unavailableVsMemberScoreCheck,
} from "@/lib/vs-performance/member-score-check.shared";
import {
  loadVsAllianceLink,
  vsAshedSyncEligibility,
} from "@/lib/vs-performance/ashed-opponent-sync.server";
import { loadVsMemberScoreEvidence } from "@/lib/vs-performance/member-score-check.server";
import { loadVsMatchup } from "@/lib/vs-performance/match-results.repository.server";
import type { VsMemberScoreCheck } from "@/lib/vs-performance/member-score-check.shared";
import {
  buildVsPlatformDraft,
  VsPerformanceError,
  conductorRuleForVsPlanDay,
  vsDatesForWeek,
  vsPlanDraftSchema,
  vsTrainDate,
  vsWeekStartSchema,
  type VsPlanDay,
  type VsPlanDraft,
} from "@/lib/vs-performance/weekly-plan.shared";
import {
  loadVsStrategyPreferences,
  loadVsWeekPlan,
  loadVsWeekPlanForUpdate,
  planDraftFromRow,
  saveVsWeekPlanRow,
} from "@/lib/vs-performance/weekly-plan.repository.server";
import { loadWeeklyPifBoard } from "@/lib/vs-performance/weekly-pif.server";
import type {
  VsActor,
  VsEffectiveDay,
  VsPlanPreview,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

export { assertVsScope, vsScope, vsContextScope };

async function resolveViewerMemberId(
  hqUserId: string | null,
  allianceId: string,
): Promise<string | null> {
  if (!hqUserId) return null;
  const [link] = await getDb()
    .select({ memberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  return link?.memberId ?? null;
}

export type VsDayResolution = {
  scoreDate: string;
  trainDate: string;
  currentRule: ConductorRule | null;
  vipRule: VipRule | null;
  locked: boolean;
  editable: boolean;
  conductorName: string | null;
};

async function resolveVsWeekDays(input: {
  allianceId: string;
  weekStart: string;
  leadDays: number;
  seasonKey: string;
  db?: TrainsDb;
  updateSeason?: boolean;
}): Promise<VsDayResolution[]> {
  const today = getServerCalendarDate();
  const out: VsDayResolution[] = [];
  for (const scoreDate of vsDatesForWeek(input.weekStart)) {
    const trainDate = vsTrainDate(scoreDate, input.leadDays);
    const config = await resolveRollDayConfig(
      input.allianceId,
      trainDate,
      input.seasonKey,
      { db: input.db, updateSeason: input.updateSeason },
    );
    const record = await getConductorRecord(
      input.allianceId,
      trainDate,
      input.seasonKey,
      input.db,
    );
    const locked = Boolean(record?.lockedAt);
    const editable = scoreDate >= today && trainDate >= today && !locked;
    out.push({
      scoreDate,
      trainDate,
      currentRule: config.conductorRule,
      vipRule: config.vipRule,
      locked,
      editable,
      conductorName: record?.conductorMemberName ?? null,
    });
  }
  return out;
}

function baselinePlanDay(day: VsPlanDay, saved: VsPlanDay | undefined): VsPlanDay {
  if (saved) return saved;
  return { ...day, strategy: "undecided", heavyHitterReward: false };
}

function samePlanDay(a: VsPlanDay, b: VsPlanDay): boolean {
  return (
    a.scoreDate === b.scoreDate &&
    a.strategy === b.strategy &&
    a.pushTopN === b.pushTopN &&
    a.heavyHitterReward === b.heavyHitterReward
  );
}

function normalizeProtectedDraftDays(input: {
  draft: VsPlanDraft;
  resolved: readonly VsDayResolution[];
  savedDays: readonly VsPlanDay[] | null;
}): VsPlanDay[] {
  return input.draft.days.map((day, index) => {
    const resolution = input.resolved[index];
    if (resolution?.editable) return day;
    const baseline = baselinePlanDay(day, input.savedDays?.[index]);
    if (!samePlanDay(day, baseline)) {
      throw new VsPerformanceError("stale", 409);
    }
    return baseline;
  });
}

function assertReapplyDates(
  reapplyDates: readonly string[],
  weekStart: string,
  resolved: readonly VsDayResolution[],
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const date of reapplyDates) {
    const index = vsDatesForWeek(weekStart).indexOf(date);
    if (index < 0 || set.has(date) || !resolved[index]?.editable) {
      throw new VsPerformanceError("invalid", 400);
    }
    set.add(date);
  }
  return set;
}

function paintPatchesForDraft(input: {
  days: readonly VsPlanDay[];
  resolved: readonly VsDayResolution[];
  savedDays: readonly VsPlanDay[] | null;
  reapplyDates: ReadonlySet<string>;
}): TrainPaintPatch[] {
  const patches: TrainPaintPatch[] = [];
  input.days.forEach((day, index) => {
    const resolution = input.resolved[index];
    if (!resolution?.editable) return;
    const rule = conductorRuleForVsPlanDay(day);
    if (rule == null) return;
    const previousRule = input.savedDays
      ? conductorRuleForVsPlanDay(input.savedDays[index]!) ?? null
      : null;
    const intentChanged =
      input.savedDays == null ||
      conductorRuleChanged(previousRule, rule);
    if (intentChanged || input.reapplyDates.has(day.scoreDate)) {
      patches.push({ date: resolution.trainDate, conductorRule: rule });
      return;
    }
    const current = resolution.currentRule;
    if (current != null && !conductorRuleChanged(current, rule)) {
      patches.push({ date: resolution.trainDate, conductorRule: rule });
    }
  });
  return patches;
}

function previewFromResolved(input: {
  allianceId: string;
  weekStart: string;
  draft: VsPlanDraft;
  planVersion: number;
  leadDays: number;
  prepared: readonly PreparedTrainPaint[];
  resolved: readonly VsDayResolution[];
  scope: string;
}): VsPlanPreview {
  const preparedByTrainDate = new Map(
    input.prepared.map((paint) => [paint.date, paint] as const),
  );
  const changes = input.resolved
    .map((day) => {
      const paint = preparedByTrainDate.get(day.trainDate);
      if (!day.editable || !paint) return null;
      const after = paint.mergedRules.conductorRule;
      if (after == null) return null;
      const clearsConductor =
        !paint.keepAssigned && Boolean(paint.record?.conductorMemberId);
      if (
        !conductorRuleChanged(paint.previousConductorRule, after) &&
        !paint.snapshotMismatch &&
        !clearsConductor
      ) {
        return null;
      }
      return {
        scoreDate: day.scoreDate,
        trainDate: day.trainDate,
        before: paint.previousConductorRule,
        after,
        clearConductorName: clearsConductor
          ? (paint.record?.conductorMemberName ?? null)
          : null,
      };
    })
    .filter((change): change is NonNullable<typeof change> => change != null);

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        allianceId: input.allianceId,
        weekStart: input.weekStart,
        draft: input.draft,
        planVersion: input.planVersion,
        leadDays: input.leadDays,
        days: input.resolved.map((day) => ({
          scoreDate: day.scoreDate,
          trainDate: day.trainDate,
          rule: day.currentRule,
          vipRule: day.vipRule,
          locked: day.locked,
          editable: day.editable,
          conductorName: day.conductorName,
        })),
        paints: input.prepared.map((paint) => ({
          date: paint.date,
          before: paint.previousConductorRule,
          after: paint.mergedRules.conductorRule,
          keepAssigned: paint.keepAssigned,
          snapshotMismatch: paint.snapshotMismatch,
          recordId: paint.record?.id ?? null,
          lockedAt: paint.record?.lockedAt ?? null,
          conductorMemberId: paint.record?.conductorMemberId ?? null,
          vipMemberId: paint.record?.vipMemberId ?? null,
        })),
      }),
    )
    .digest("hex");

  return {
    fingerprint,
    planVersion: input.planVersion,
    changes,
    protectedDates: input.resolved
      .filter((day) => !day.editable)
      .map((day) => day.scoreDate),
    scope: input.scope,
  };
}

export async function loadVsPerformanceWeek(
  sessionId: string,
  weekStart: string,
  expectedActor?: VsActor,
): Promise<VsWeekPayload> {
  const session = await loadSession(sessionId);
  const allianceId = session?.currentAllianceId ?? session?.allianceId;
  if (!allianceId || !session) throw new VsPerformanceError("forbidden", 403);
  if (
    expectedActor &&
    (expectedActor.sessionId !== sessionId ||
      expectedActor.allianceId !== allianceId ||
      expectedActor.hqUserId !== (session.hqUserId ?? null))
  ) {
    throw new VsPerformanceError("forbidden", 403);
  }
  const monday = vsWeekStartSchema.parse(weekStart);
  const today = getServerCalendarDate();
  const actor: VsActor = {
    sessionId,
    hqUserId: session.hqUserId ?? null,
    allianceId,
  };
  const [
    canEdit,
    leadDays,
    seasonKey,
    planRow,
    preferences,
    matchup,
    viewerMemberId,
    allianceRow,
    ashedLink,
    canSyncAshed,
  ] = await Promise.all([
    sessionHasPermission(sessionId, "trains:write"),
    loadAllianceTrainLeadTimeDays(allianceId),
    resolveTrainSeasonKey(allianceId),
    loadVsWeekPlan(allianceId, monday),
    loadVsStrategyPreferences(allianceId),
    loadVsMatchup(allianceId, monday, undefined, actor),
    resolveViewerMemberId(session.hqUserId ?? null, allianceId),
    getDb()
      .select({
        tag: schema.alliances.tag,
        name: schema.alliances.name,
        gameServerNumber: schema.alliances.gameServerNumber,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, allianceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    loadVsAllianceLink(allianceId),
    vsAshedSyncEligibility(actor).catch(() => false),
  ]);

  const plan = planRow ? planDraftFromRow(planRow) : null;
  const baseDraft =
    plan ??
    buildVsPlatformDraft(monday, "strategic_victory", preferences.defaults);
  const resolved = await resolveVsWeekDays({
    allianceId,
    weekStart: monday,
    leadDays,
    seasonKey,
    updateSeason: false,
  });

  const days: VsEffectiveDay[] = baseDraft.days.map((day, index) => {
    const resolution = resolved[index]!;
    const planned = conductorRuleForVsPlanDay(day) ?? null;
    return {
      ...day,
      trainDate: resolution.trainDate,
      currentRule: resolution.currentRule,
      vipRule: resolution.vipRule,
      locked: resolution.locked,
      editable: resolution.editable,
      override:
        plan != null &&
        planned != null &&
        conductorRuleChanged(resolution.currentRule, planned),
      conductorName: resolution.conductorName,
    };
  });

  const points = calculateVsWeekPoints(
    monday,
    (matchup?.days ?? []).map((day) => ({
      recordedDate: day.recordedDate,
      totals: day.totals,
      outcome: day.outcome,
      finality: day.finality,
    })),
    today,
  );

  let pif: VsWeekPayload["pif"] = null;
  let pifError: string | null = null;
  try {
    pif = await loadWeeklyPifBoard({
      allianceId,
      weekStart: monday,
      leadDays,
      viewerMemberId,
      resolvedDays: resolved,
    });
  } catch {
    pifError = "load";
  }

  const memberScoreChecks: Record<string, VsMemberScoreCheck> = {};
  const confirmedHeads = (matchup?.days ?? []).filter(
    (day) => day.finality === "final" && day.totals != null,
  );
  if (confirmedHeads.length > 0) {
    const scoreCache = new Map<string, Promise<Map<string, number>>>();
    const scoresForDate = (date: string): Promise<Map<string, number>> => {
      let pending = scoreCache.get(date);
      if (!pending) {
        pending = loadVsMemberScoreEvidence(actor, date);
        scoreCache.set(date, pending);
      }
      return pending;
    };
    for (const head of confirmedHeads) {
      try {
        const scores = await scoresForDate(head.recordedDate);
        memberScoreChecks[head.recordedDate] = compareVsMemberScores(
          head.totals!.ourScore,
          scores,
        );
      } catch {
        memberScoreChecks[head.recordedDate] = unavailableVsMemberScoreCheck(
          head.totals!.ourScore,
        );
      }
    }
  }

  if (expectedActor) await assertVsActorCurrent(expectedActor, "scores:read");
  return {
    weekStart: monday,
    today,
    scope: vsScope(actor, monday),
    contextScope: vsContextScope(actor),
    canEdit,
    leadDays,
    plan,
    preferences,
    days,
    matchup,
    points,
    pif,
    pifError,
    canImportAshed: canSyncAshed,
    ashedLinked: ashedLink != null,
    memberScoreChecks,
    allianceIdentity: {
      tag: allianceRow?.tag ?? null,
      name: allianceRow?.name ?? null,
      server: allianceRow?.gameServerNumber ?? null,
    },
  };
}

async function buildVsPlanPreview(input: {
  actor: VsActor;
  draft: VsPlanDraft;
  planVersion: number;
  leadDays: number;
  seasonKey: string;
  inputs: TrainPaintInputs;
  resolved: readonly VsDayResolution[];
  savedDays: readonly VsPlanDay[] | null;
  reapplyDates: ReadonlySet<string>;
  db?: TrainsDb;
  updateSeason?: boolean;
  readOnly?: boolean;
}): Promise<VsPlanPreview & { prepared: PreparedTrainPaint[] }> {
  const { actor, draft } = input;
  const patches = paintPatchesForDraft({
    days: draft.days,
    resolved: input.resolved,
    savedDays: input.savedDays,
    reapplyDates: input.reapplyDates,
  });
  const prepared = await prepareTrainPaints(
    actor.allianceId,
    patches,
    input.inputs,
    {
      db: input.db,
      updateSeason: input.updateSeason,
      readOnly: input.readOnly,
    },
  );
  return {
    ...previewFromResolved({
      allianceId: actor.allianceId,
      weekStart: draft.weekStart,
      draft,
      planVersion: input.planVersion,
      leadDays: input.leadDays,
      prepared,
      resolved: input.resolved,
      scope: vsScope(actor, draft.weekStart),
    }),
    prepared,
  };
}

async function paintInputsForDraft(
  actor: VsActor,
  resolved: readonly VsDayResolution[],
  draft: VsPlanDraft,
  savedDays: readonly VsPlanDay[] | null,
  reapplyDates: ReadonlySet<string>,
): Promise<TrainPaintInputs> {
  const patches = paintPatchesForDraft({
    days: draft.days,
    resolved,
    savedDays,
    reapplyDates,
  });
  return loadTrainPaintInputs(actor.allianceId, patches);
}

export async function previewVsWeekPlan(
  actor: VsActor,
  draft: unknown,
  expectedVersion: number,
  scope: unknown,
  reapplyDates?: readonly string[],
): Promise<VsPlanPreview> {
  const parsed = vsPlanDraftSchema.parse(draft);
  assertVsScope(actor, parsed.weekStart, scope);
  const [leadDays, seasonKey, planRow] = await Promise.all([
    loadAllianceTrainLeadTimeDays(actor.allianceId),
    resolveTrainSeasonKey(actor.allianceId),
    loadVsWeekPlan(actor.allianceId, parsed.weekStart),
  ]);
  const planVersion = planRow?.version ?? 0;
  if (planVersion !== expectedVersion) {
    throw new VsPerformanceError("stale", 409);
  }
  const savedDays = planRow ? planDraftFromRow(planRow).days : null;
  const resolved = await resolveVsWeekDays({
    allianceId: actor.allianceId,
    weekStart: parsed.weekStart,
    leadDays,
    seasonKey,
    updateSeason: false,
  });
  const reapply = assertReapplyDates(
    reapplyDates ?? [],
    parsed.weekStart,
    resolved,
  );
  const normalizedDays = normalizeProtectedDraftDays({
    draft: parsed,
    resolved,
    savedDays,
  });
  const normalizedDraft: VsPlanDraft = { ...parsed, days: normalizedDays };
  const inputs = await paintInputsForDraft(
    actor,
    resolved,
    normalizedDraft,
    savedDays,
    reapply,
  );
  const { prepared, ...preview } = await buildVsPlanPreview({
    actor,
    draft: normalizedDraft,
    planVersion,
    leadDays,
    seasonKey,
    inputs,
    resolved,
    savedDays,
    reapplyDates: reapply,
    updateSeason: false,
    readOnly: true,
  });
  void prepared;
  return preview;
}

export async function saveVsWeekPlan(
  actor: VsActor,
  input: {
    draft: unknown;
    expectedVersion: number;
    fingerprint: string;
    scope: string;
    reapplyDates?: string[];
  },
): Promise<VsWeekPayload> {
  const draft = vsPlanDraftSchema.parse(input.draft);
  assertVsScope(actor, draft.weekStart, input.scope);
  const reapplyDates = Array.isArray(input.reapplyDates)
    ? input.reapplyDates
    : [];

  const [leadDays, seasonKey] = await Promise.all([
    loadAllianceTrainLeadTimeDays(actor.allianceId),
    resolveTrainSeasonKey(actor.allianceId),
  ]);

  const db = getDb();
  await db.transaction(async (tx: AvailabilityTransaction) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    const settings = await lockAllianceTrainSettings(tx, actor.allianceId);
    if (
      !settings ||
      settings.leadDays !== leadDays ||
      settings.seasonKey !== seasonKey
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const planRow = await loadVsWeekPlanForUpdate(
      tx,
      actor.allianceId,
      draft.weekStart,
    );
    const planVersion = planRow?.version ?? 0;
    if (planVersion !== input.expectedVersion) {
      throw new VsPerformanceError("stale", 409);
    }
    const savedDays = planRow ? planDraftFromRow(planRow).days : null;

    const resolved = await resolveVsWeekDays({
      allianceId: actor.allianceId,
      weekStart: draft.weekStart,
      leadDays: settings.leadDays,
      seasonKey: settings.seasonKey,
      db: tx,
      updateSeason: false,
    });
    const reapply = assertReapplyDates(
      reapplyDates,
      draft.weekStart,
      resolved,
    );
    const normalizedDays = normalizeProtectedDraftDays({
      draft,
      resolved,
      savedDays,
    });
    const normalizedDraft: VsPlanDraft = { ...draft, days: normalizedDays };
    const patches = paintPatchesForDraft({
      days: normalizedDays,
      resolved,
      savedDays,
      reapplyDates: reapply,
    });

    const activeMemberIds = new Set(
      (
        await listActiveAllianceMembersForPool(actor.allianceId, tx, {
          lock: true,
        })
      ).map(
        (member) => member.ashedMemberId,
      ),
    );
    const txInputs: TrainPaintInputs = {
      seasonKey: settings.seasonKey,
      trainWeekConfig: settings.trainWeekConfig,
      weekStarts: [
        ...new Set(patches.map((patch) => scheduleWeekStart(patch.date))),
      ].sort(),
      activeMemberIds,
    };

    const { fingerprint } = await buildVsPlanPreview({
      actor,
      draft: normalizedDraft,
      planVersion,
      leadDays: settings.leadDays,
      seasonKey: settings.seasonKey,
      inputs: txInputs,
      resolved,
      savedDays,
      reapplyDates: reapply,
      db: tx,
      readOnly: true,
    });
    if (fingerprint !== input.fingerprint) {
      throw new VsPerformanceError("stale", 409);
    }

    for (const weekStart of txInputs.weekStarts) {
      await ensureWeekScheduleBaseline(
        actor.allianceId,
        weekStart,
        null,
        tx,
        settings.seasonKey,
      );
    }
    const prepared = await prepareTrainPaints(
      actor.allianceId,
      patches,
      txInputs,
      { db: tx },
    );

    const appliedRules: Record<string, ConductorRule | null> = {};
    for (const paint of prepared) {
      appliedRules[paint.date] = paint.mergedRules.conductorRule;
    }
    await saveVsWeekPlanRow(tx, {
      allianceId: actor.allianceId,
      draft: normalizedDraft,
      leadDays: settings.leadDays,
      appliedRules,
      expectedVersion: input.expectedVersion,
      actorHqUserId: actor.hqUserId,
    });
    await commitTrainPaints(tx, actor.allianceId, prepared, txInputs);
  });

  await writeTrainsOfficerAudit({
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.week_plan_save",
    severity: "update",
    resourceType: "vs_week_plan",
    resourceId: `${actor.allianceId}:${draft.weekStart}`,
    metadata: { weekStart: draft.weekStart, platform: draft.platform },
  });

  return loadVsPerformanceWeek(actor.sessionId, draft.weekStart);
}
