import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { sessionHasPermission } from "@/lib/rbac/context";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { resolveTrainActorHqUserId } from "@/lib/trains/train-ownership.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  EventEligibilityError,
  previewEventEligibility,
} from "@/lib/trains/event-eligibility.server";
import {
  conductorRuleSchema,
  vipRuleSchema,
} from "@/lib/trains/rules/catalog.shared";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof EventEligibilityError) {
    return NextResponse.json(
      { error: "event_eligibility", code: error.code },
      { status: error.code === "unbound" ? 400 : 404 },
    );
  }
  return NextResponse.json(
    { error: "event_eligibility_failed" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;

  // Saved-rule preview is read-only; proposed-rule previews (POST) need
  // trains:write.
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const params = new URL(request.url).searchParams;
  const date = params.get("date")?.trim() || getServerCalendarDate();
  const role = params.get("role") === "vip" ? "vip" : "conductor";

  try {
    const preview = await previewEventEligibility(
      {
        allianceId: ctx.allianceId,
        hqUserId: await resolveTrainActorHqUserId(session.id),
        sessionId: session.id,
      },
      {
        date,
        role,
        includeExcludedDetail: await sessionHasPermission(
          session.id,
          "scores:write",
        ),
      },
    );
    return NextResponse.json({ preview });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;

  const denied = await requireSessionPermission(session.id, "trains:write");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json().catch(() => ({}))) as {
    date?: string;
    role?: string;
    rule?: unknown;
  };
  const date = body.date?.trim() || getServerCalendarDate();
  const role = body.role === "vip" ? "vip" : "conductor";

  const schema = role === "vip" ? vipRuleSchema : conductorRuleSchema;
  const parsed = schema.safeParse(body.rule);
  if (!parsed.success || parsed.data.kind !== "event_scores") {
    return NextResponse.json(
      { error: "invalid_rule", code: "invalid_rule" },
      { status: 400 },
    );
  }

  try {
    const preview = await previewEventEligibility(
      {
        allianceId: ctx.allianceId,
        hqUserId: await resolveTrainActorHqUserId(session.id),
        sessionId: session.id,
      },
      {
        date,
        role,
        rule: parsed.data,
        includeExcludedDetail: await sessionHasPermission(
          session.id,
          "scores:write",
        ),
      },
    );
    return NextResponse.json({ preview });
  } catch (error) {
    return errorResponse(error);
  }
}
