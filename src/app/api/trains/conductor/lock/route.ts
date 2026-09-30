import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { lockConductorWithBoarding as lockConductorRecord } from "@/lib/trains/boarding.server";
import { normalizeDiscordBotLocale } from "@/lib/discord/i18n";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadAllianceTrainLeadTimeSettings } from "@/lib/trains/alliance-train-lead-time.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { conductorLockBlockedByPendingConfirmation } from "@/lib/trains/conductor-record.shared";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getConductorRecord,
  restampConductorRules,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import {
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
} from "@/lib/trains/rules/encode.shared";
import { conductorRuleChanged } from "@/lib/trains/conductor-mechanism.shared";
import { parseConductorRule } from "@/lib/trains/rules/catalog.shared";
import { shouldKeepAssignedConductorOnPaint } from "@/lib/trains/paint-rule-conductor-gate.shared";
import { getMemberRankAsOf, resolveMemberAllianceRankAsOf } from "@/lib/trains/rank-history";
import { maybeAnnounceTrainReady } from "@/lib/trains/discord-bot.server";
import {
  getServerCalendarDate,
  refreshExhaustedPoolsForDay,
  syncDepletingPoolSelectionForConductorDay,
} from "@/lib/trains/service";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { resolveTrainActorHqUserId } from "@/lib/trains/train-ownership.server";

export const dynamic = "force-dynamic";

import { withTrainCoverage } from "@/lib/time-off/train-coverage-route.server";
export const POST = withTrainCoverage(post);

async function post(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    date?: string;
    memberId?: string;
    memberName?: string;
    announce?: boolean;
    locale?: string;
  };

  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    let record = await getConductorRecord(ctx.allianceId, date, seasonKey);
    const dayConfig = await resolveRollDayConfig(
      ctx.allianceId,
      date,
      seasonKey,
    );

    if (body.memberId && body.memberName && record?.conductorMemberId !== body.memberId) {
      const rankEvent = await getMemberRankAsOf(
        ctx.allianceId,
        body.memberId,
        date,
      );
      record = await upsertConductorDraft({
        allianceId: ctx.allianceId,
        date,
        seasonKey,
        conductorMemberId: body.memberId,
        conductorMemberName: body.memberName,
        conductorRankEventId: rankEvent?.id ?? null,
        conductorRule: dayConfig.conductorRule,
        vipRule: dayConfig.vipRule,
        conductorMechanism: encodeLegacyConductorMechanism(
          dayConfig.conductorRule,
        ),
        vipMechanism: encodeLegacyVipMechanism(dayConfig.vipRule),
        dayConfigId: dayConfig.dayConfigId,
      });
    } else if (
      record?.conductorMemberId &&
      conductorRuleChanged(
        parseConductorRule(record.conductorRule),
        dayConfig.conductorRule,
      )
    ) {
      const roster = await loadActiveAlliancePoolMembers({
        allianceId: ctx.allianceId,
      });
      const resolved = await resolveMemberAllianceRankAsOf(
        ctx.allianceId,
        record.conductorMemberId,
        date,
      );
      const keep = shouldKeepAssignedConductorOnPaint({
        ruleChanged: true,
        memberId: record.conductorMemberId,
        onRoster: roster.some(
          (member) => member.ashedMemberId === record!.conductorMemberId,
        ),
        allianceRank: resolved.rank,
        nextRule: dayConfig.conductorRule,
      });
      if (keep) {
        const restamped = await restampConductorRules({
          allianceId: ctx.allianceId,
          date,
          seasonKey,
          conductorRule: dayConfig.conductorRule,
          vipRule: dayConfig.vipRule,
        });
        if (restamped) record = restamped;
      }
    }

    if (!record) {
      return NextResponse.json(
        { error: "Roll or select a conductor first." },
        { status: 400 },
      );
    }

    const leadTime = await loadAllianceTrainLeadTimeSettings(
      ctx.allianceId,
      false,
    );
    if (
      conductorLockBlockedByPendingConfirmation(
        leadTime.trainConductorConfirmationEnabled,
        record.conductorNominationStatus,
      )
    ) {
      return NextResponse.json(
        {
          error: "Confirm the nominated conductor before locking.",
          code: "conductor_confirmation_pending",
        },
        { status: 409 },
      );
    }

    const locked = await lockConductorRecord(
      record.id,
      ctx.allianceId,
      await resolveTrainActorHqUserId(session.id),
    );
    await syncDepletingPoolSelectionForConductorDay({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
      memberId: locked.conductorMemberId,
    });
    const poolsRefreshed = await refreshExhaustedPoolsForDay({
      allianceId: ctx.allianceId,
      date,
      seasonKey,
    });

    if (body.announce !== false) {
      await maybeAnnounceTrainReady({
        allianceId: ctx.allianceId,
        date,
        conductorName: locked.conductorMemberName,
        vipName: locked.vipMemberName,
        locale: normalizeDiscordBotLocale(body.locale),
      });
    }

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.conductor_lock",
      severity: "routine",
      resourceType: "train_conductor_record",
      resourceId: locked.id,
      resourceName: locked.conductorMemberName,
      metadata: {
        date,
        conductorMemberId: locked.conductorMemberId,
        announced: body.announce !== false,
      },
    });

    return NextResponse.json({ record: locked, poolsRefreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lock failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
