import "server-only";

import { createHash, randomInt } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { schema } from "@/lib/db";
import { recordDaySpinExclusion } from "@/lib/trains/day-spin-exclusions.server";
import {
  previewEventEligibility,
  type EventEligibilityActor,
} from "@/lib/trains/event-eligibility.server";
import type { EventEligibilityRole } from "@/lib/trains/event-eligibility.shared";
import {
  assignVipOnLockedConductor,
  getConductorRecord,
  upsertConductorDraft,
  withTrainScheduleWriteLock,
} from "@/lib/trains/repository";
import {
  conductorRuleIdentity,
  vipRuleIdentity,
  type EventScoresRule,
} from "@/lib/trains/rules/catalog.shared";
import { TrainRollError } from "@/lib/trains/roll-errors.server";
import type {
  ConductorMechanismType,
  RollResult,
  VipMechanismType,
} from "@/lib/trains/types";

export class EventDrawError extends TrainRollError {}

export function throwEventDraw(
  code:
    | "EVENT_NOT_SELECTED"
    | "EVENT_NOT_READY"
    | "ELIGIBILITY_CHANGED"
    | "READINESS_INVALIDATED"
    | "PENDING_EVIDENCE"
    | "CONFIRM_POLL_FALLBACK"
    | "REQUEST_CONFLICT"
    | "NO_WHEEL_CANDIDATES",
  message: string,
): never {
  throw new EventDrawError(message, { code });
}

function drawSignature(input: {
  date: string;
  role: EventEligibilityRole;
  ruleIdentity: string;
  fingerprint: string;
  acknowledgePollFallback: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        date: input.date,
        role: input.role,
        rule: input.ruleIdentity,
        fingerprint: input.fingerprint,
        fallback: input.acknowledgePollFallback,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}


export type RollEventForTrainResult = {
  result: RollResult;
  draw: typeof schema.trainEventDraws.$inferSelect;
  idempotentReplay: boolean;
};

/**
 * Atomic train draw from a ready event-evidence board. The caller supplies the
 * fingerprint it previewed; a mismatch means roster/readiness/availability
 * changed underneath the preview and the caller must re-preview (409).
 */
export async function rollEventForTrain(
  actor: EventEligibilityActor & { allianceId: string },
  input: {
    date: string;
    role: EventEligibilityRole;
    requestId: string;
    expectedEligibilityFingerprint: string;
    acknowledgePollFallback?: boolean;
    seasonKey?: string | null;
  },
): Promise<RollEventForTrainResult> {
  const requestId = input.requestId?.trim();
  if (!requestId) throwEventDraw("REQUEST_CONFLICT", "requestId required.");
  if (!input.expectedEligibilityFingerprint) {
    throwEventDraw(
      "ELIGIBILITY_CHANGED",
      "Eligibility fingerprint required.",
    );
  }
  const acknowledgePollFallback = input.acknowledgePollFallback === true;

  return withTrainScheduleWriteLock(actor.allianceId, undefined, async (tx) => {
    // Idempotent replay / conflicting signature on (alliance, requestId).
    // Compared against the full request signature after the rule is loaded.
    const [existing] = await tx
      .select()
      .from(schema.trainEventDraws)
      .where(
        and(
          eq(schema.trainEventDraws.allianceId, actor.allianceId),
          eq(schema.trainEventDraws.requestId, requestId),
        ),
      )
      .limit(1);

    const seasonKey =
      input.seasonKey ??
      (await (
        await import("@/lib/trains/service")
      ).resolveTrainSeasonKey(actor.allianceId, tx));

    const rule = await loadDayEventRule(actor, input, seasonKey, tx);
    if (!rule) {
      throwEventDraw(
        "EVENT_NOT_SELECTED",
        "Select a reviewed event before spinning.",
      );
    }
    const ruleIdentity =
      input.role === "vip" ? vipRuleIdentity(rule) : conductorRuleIdentity(rule);
    const signature = drawSignature({
      date: input.date,
      role: input.role,
      ruleIdentity,
      fingerprint: input.expectedEligibilityFingerprint,
      acknowledgePollFallback,
    });

    // Same requestId + same signature replays the original draw without
    // touching eligibility again; any other field under the same requestId is
    // a caller bug and conflicts.
    if (existing) {
      if (existing.requestSignature === signature) {
        return {
          result: {
            memberId: existing.winnerMemberId,
            memberName: existing.winnerMemberName ?? "",
            mechanism:
              input.role === "vip"
                ? ("event_scores" as VipMechanismType)
                : ("event_scores" as ConductorMechanismType),
            isAutomatic: false,
          },
          draw: existing,
          idempotentReplay: true,
        };
      }
      throwEventDraw(
        "REQUEST_CONFLICT",
        "requestId was already used for a different draw.",
      );
    }

    const preview = await previewEventEligibility(actor, {
      date: input.date,
      role: input.role,
      rule,
      seasonKey,
      db: tx,
      forUpdate: true,
    });

    const eligibility = preview.eligibility;
    if (!eligibility.ok) {
      if (eligibility.reason === "unbound") {
        throwEventDraw(
          "EVENT_NOT_SELECTED",
          "Select a reviewed event before spinning.",
        );
      }
      throwEventDraw(
        "PENDING_EVIDENCE",
        "Event evidence is not confirmed ready.",
      );
    }
    if (preview.fingerprint !== input.expectedEligibilityFingerprint) {
      throwEventDraw(
        "ELIGIBILITY_CHANGED",
        "Eligibility changed since the preview — re-check the list.",
      );
    }

    const useFallback =
      eligibility.candidates.length === 0 && eligibility.fallback.available;
    if (eligibility.candidates.length === 0 && !useFallback) {
      throwEventDraw(
        "PENDING_EVIDENCE",
        "No drawable members on this event.",
      );
    }
    if (useFallback && !acknowledgePollFallback) {
      throwEventDraw(
        "CONFIRM_POLL_FALLBACK",
        "Confirm the Yes-respondent fallback before spinning.",
      );
    }

    // VIP draws require a locked conductor; the pure eligibility already
    // excluded the conductor from candidates.
    const record = await getConductorRecord(actor.allianceId, input.date, seasonKey, tx);
    if (input.role === "vip" && (!record?.lockedAt || !record.conductorMemberId)) {
      throwEventDraw(
        "EVENT_NOT_SELECTED",
        "Lock the conductor before spinning VIP.",
      );
    }
    if (input.role === "conductor" && record?.lockedAt) {
      throwEventDraw(
        "REQUEST_CONFLICT",
        "Conductor is already locked for this day.",
      );
    }

    const pool = useFallback
      ? (eligibility.fallbackCandidates ?? [])
      : eligibility.candidates.map((candidate) => candidate.memberId);
    if (pool.length === 0) {
      throwEventDraw("PENDING_EVIDENCE", "No drawable members on this event.");
    }
    const winnerId = pool[randomInt(0, pool.length)]!;

    // The receipt snapshots the pool actually drawn from — under the poll
    // fallback that is the Yes respondents, not the empty scored board.
    const receiptCandidates = useFallback
      ? await fallbackCandidateSnapshot(actor.allianceId, pool, tx)
      : eligibility.candidates;
    const candidatesHash = createHash("sha256")
      .update(JSON.stringify(receiptCandidates))
      .digest("hex");
    const winnerName =
      receiptCandidates.find((candidate) => candidate.memberId === winnerId)
        ?.memberName ??
      (await memberNameFor(actor.allianceId, winnerId, tx)) ??
      "";

    const boardRevisions = preview.boardRevisions;

    const [draw] = await tx
      .insert(schema.trainEventDraws)
      .values({
        id: nanoid(),
        allianceId: actor.allianceId,
        date: input.date,
        role: input.role,
        requestId,
        requestSignature: signature,
        ruleIdentity,
        rule,
        hqEventId: preview.sourceIdentity.occurrenceId ?? "",
        boardRevisions,
        eligibilityFingerprint: preview.fingerprint!,
        candidates: receiptCandidates,
        candidatesHash,
        winnerMemberId: winnerId,
        winnerMemberName: winnerName,
        fallbackUsed: useFallback ? 1 : 0,
        fallbackAcknowledged: useFallback && acknowledgePollFallback ? 1 : 0,
        actorHqUserId: actor.hqUserId ?? null,
      })
      .returning();
    if (!draw) throw new Error("Failed to persist event draw.");

    await recordDaySpinExclusion({
      allianceId: actor.allianceId,
      date: input.date,
      memberId: winnerId,
      memberName: winnerName,
      tx,
    });

    if (input.role === "vip") {
      await assignVipOnLockedConductor({
        allianceId: actor.allianceId,
        date: input.date,
        seasonKey,
        vipMemberId: winnerId,
        vipMemberName: winnerName,
        vipMechanism: "event_scores",
        vipRule: rule,
        vipEventDrawId: draw.id,
        tx,
      });
    } else {
      await upsertConductorDraft({
        allianceId: actor.allianceId,
        date: input.date,
        seasonKey,
        conductorMemberId: winnerId,
        conductorMemberName: winnerName,
        conductorMechanism: "event_scores",
        conductorRule: rule,
        conductorEventDrawId: draw.id,
        tx,
      });
    }

    return {
      result: {
        memberId: winnerId,
        memberName: winnerName,
        mechanism:
          input.role === "vip"
            ? ("event_scores" as VipMechanismType)
            : ("event_scores" as ConductorMechanismType),
        isAutomatic: false,
        draftPersisted: true,
      },
      draw,
      idempotentReplay: false,
    };
  });
}

async function loadDayEventRule(
  actor: Pick<EventEligibilityActor, "allianceId">,
  input: { date: string; role: EventEligibilityRole },
  seasonKey: string,
  tx: Parameters<Parameters<typeof withTrainScheduleWriteLock>[2]>[0],
): Promise<EventScoresRule | null> {
  const { resolveRollDayConfig } = await import(
    "@/lib/trains/day-config-resolve.server"
  );
  const dayConfig = await resolveRollDayConfig(
    actor.allianceId,
    input.date,
    seasonKey,
    { db: tx },
  );
  const rule =
    input.role === "vip" ? dayConfig.vipRule : dayConfig.conductorRule;
  return rule?.kind === "event_scores" ? rule : null;
}

async function fallbackCandidateSnapshot(
  allianceId: string,
  memberIds: string[],
  tx: Parameters<Parameters<typeof withTrainScheduleWriteLock>[2]>[0],
): Promise<
  {
    memberId: string;
    memberName: string | null;
    eventScore: string | null;
    stage: number | null;
    evidenceKind: string;
  }[]
> {
  if (memberIds.length === 0) return [];
  const rows = await tx
    .select({
      memberId: schema.allianceMembers.ashedMemberId,
      name: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        inArray(schema.allianceMembers.ashedMemberId, memberIds),
      ),
    );
  const names = new Map(rows.map((row) => [row.memberId, row.name]));
  return [...memberIds].sort().map((memberId) => ({
    memberId,
    memberName: names.get(memberId) ?? null,
    eventScore: null,
    stage: null,
    evidenceKind: "poll_yes",
  }));
}

async function memberNameFor(
  allianceId: string,
  memberId: string,
  tx: Parameters<Parameters<typeof withTrainScheduleWriteLock>[2]>[0],
): Promise<string | null> {
  const [row] = await tx
    .select({ name: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, memberId),
      ),
    )
    .limit(1);
  return row?.name ?? null;
}
