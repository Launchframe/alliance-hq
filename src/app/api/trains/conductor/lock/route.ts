import { NextResponse } from "next/server";

import { normalizeDiscordBotLocale } from "@/lib/discord/i18n";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { loadAllianceTrainLeadTimeSettings } from "@/lib/trains/alliance-train-lead-time.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { conductorLockBlockedByPendingConfirmation } from "@/lib/trains/conductor-record.shared";
import {
  getConductorRecord,
  lockConductorRecord,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
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

export async function POST(request: Request) {
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

    if (body.memberId && body.memberName) {
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
      });
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

    return NextResponse.json({ record: locked, poolsRefreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lock failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
