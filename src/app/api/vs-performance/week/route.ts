import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireApiSession,
} from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import {
  loadVsPerformanceWeek,
  saveVsWeekPlan,
} from "@/lib/vs-performance/weekly-plan.server";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";
import { vsWeekStartSchema } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";

const saveWeekPlanBodySchema = z
  .object({
    draft: z.unknown(),
    expectedVersion: z.number().int().min(0),
    fingerprint: z.string().min(1).max(200),
    scope: z.string().min(1).max(200),
    reapplyDates: z.array(z.string().max(16)).max(6).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const url = new URL(request.url);
  const raw = url.searchParams.get("weekStart");
  let weekStart: string;
  if (raw == null || raw === "") {
    weekStart = getWeekStartMonday(getServerCalendarDate());
  } else {
    const parsed = vsWeekStartSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid", code: "invalid" },
        { status: 400 },
      );
    }
    weekStart = parsed.data;
  }
  try {
    const payload = await loadVsPerformanceWeek(session.id, weekStart);
    return NextResponse.json(payload);
  } catch (error) {
    return vsErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  try {
    const input = saveWeekPlanBodySchema.parse(body);
    const payload = await saveVsWeekPlan(actor, input);
    return NextResponse.json(payload);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
