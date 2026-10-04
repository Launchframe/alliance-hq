import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getActivityPrincipalForSession } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  getCommanderByAshedMemberId,
  setWeeklyPass,
  WeeklyPassTargetChangedError,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ashedMemberId: z.string().trim().min(1),
  active: z.boolean(),
});

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:write");
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

  const commander = await getCommanderByAshedMemberId(
    body.ashedMemberId,
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
      ashedMemberId: body.ashedMemberId,
      active: body.active,
      source: "officer",
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
