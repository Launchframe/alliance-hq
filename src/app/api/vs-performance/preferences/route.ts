import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import {
  loadVsStrategyPreferences,
  saveVsStrategyPreferences,
} from "@/lib/vs-performance/weekly-plan.repository.server";
import { assertVsScope } from "@/lib/vs-performance/vs-scope.server";
import {
  vsPushDefaultsSchema,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";

export const dynamic = "force-dynamic";

const preferencesBodySchema = z
  .object({
    defaults: z.unknown(),
    expectedVersion: z.number().int().min(0),
    weekStart: vsWeekStartSchema,
    scope: z.string().min(1).max(200),
  })
  .strict();

export async function GET() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  const preferences = await loadVsStrategyPreferences(actor.allianceId);
  return NextResponse.json(preferences);
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
    const input = preferencesBodySchema.parse(body);
    assertVsScope(actor, input.weekStart, input.scope);
    const defaults = vsPushDefaultsSchema.parse(input.defaults);
    const saved = await saveVsStrategyPreferences(actor.allianceId, {
      defaults,
      expectedVersion: input.expectedVersion,
      actorHqUserId: actor.hqUserId,
    });
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.strategy_preferences_save",
      severity: "update",
      resourceType: "vs_strategy_preferences",
      resourceId: actor.allianceId,
      metadata: { defaults },
    });
    return NextResponse.json(saved);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
