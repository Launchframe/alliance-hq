import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getActivityPrincipalForSession } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  getCommanderByAshedMemberId,
  setWeeklyPass,
  WeeklyPassTargetChangedError,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  active: z.boolean(),
});

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const principal = await getActivityPrincipalForSession(session);
  if (!principal || principal.currentAllianceId !== allianceId) {
    const t = await getTranslations("activity");
    return NextResponse.json({ error: t("accessChanged") }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const link = await getHqMemberLinkForUser(allianceId, session.hqUserId);
  if (!link) {
    return NextResponse.json(
      { code: "member_link_required", error: "Link your commander first." },
      { status: 403 },
    );
  }

  const commander = await getCommanderByAshedMemberId(
    link.ashedMemberId,
    allianceId,
  );
  if (!commander) {
    return NextResponse.json(
      { error: "Commander not found in this alliance." },
      { status: 404 },
    );
  }

  try {
    await setWeeklyPass({
      commanderId: commander.commanderId,
      allianceId,
      ashedMemberId: link.ashedMemberId,
      active: body.active,
      source: "self",
      activity: { identity: { kind: "web", principal } },
    });
  } catch (error) {
    if (error instanceof ActivityWriteError) {
      const t = await getTranslations("activity");
      return NextResponse.json({ error: t("saveBlocked") }, { status: 503 });
    }
    if (error instanceof WeeklyPassTargetChangedError) {
      const t = await getTranslations("discordBot.weeklyPass");
      return NextResponse.json(
        { error: t("commanderNotFound") },
        { status: 404 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
