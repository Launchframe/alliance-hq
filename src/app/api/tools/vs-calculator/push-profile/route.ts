import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import type { HeroDayPushProfilePayload } from "@/lib/vs-calculator/planner/planner-types.shared";
import {
  resolveCommanderForVsCalculator,
} from "@/lib/vs-calculator/inventory.server";
import {
  getCommanderVsPushProfile,
  putCommanderVsPushProfile,
} from "@/lib/vs-calculator/push-profile.server";
import { loadVsCalculatorForUser } from "@/lib/vs-calculator/web-vs-calculator-read.server";

export const dynamic = "force-dynamic";

type Body = {
  payload?: HeroDayPushProfilePayload;
  pinnedDate?: string | null;
  locale?: string | null;
};

async function loadSessionContext(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const commanderId = await resolveCommanderForVsCalculator({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!commanderId) {
    return NextResponse.json(
      { code: "member_link_required", error: "Link your commander first." },
      { status: 403 },
    );
  }

  return { session, allianceId, commanderId, hqUserId: session.hqUserId };
}

export async function GET(request: Request) {
  const ctx = await loadSessionContext(request);
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const payload = await getCommanderVsPushProfile(ctx.commanderId);
  const calculator = await loadVsCalculatorForUser({
    allianceId: ctx.allianceId,
    hqUserId: ctx.hqUserId,
    pinnedDate: url.searchParams.get("date") ?? undefined,
    locale: url.searchParams.get("locale") ?? undefined,
  });

  return NextResponse.json({ payload, calculator });
}

export async function PUT(request: Request) {
  const ctx = await loadSessionContext(request);
  if (ctx instanceof NextResponse) return ctx;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "payload is required." }, { status: 400 });
  }

  const payload = await putCommanderVsPushProfile({
    commanderId: ctx.commanderId,
    payload: body.payload,
    hqUserId: ctx.hqUserId,
  });

  const calculator = await loadVsCalculatorForUser({
    allianceId: ctx.allianceId,
    hqUserId: ctx.hqUserId,
    pinnedDate: body.pinnedDate,
    locale: body.locale ?? undefined,
  });

  return NextResponse.json({ payload, calculator });
}
