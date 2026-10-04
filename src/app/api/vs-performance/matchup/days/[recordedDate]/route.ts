import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { saveVsMatchDayResult } from "@/lib/vs-performance/match-results.server";
import {
  isVsCalendarDate,
  vsDateSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import {
  VS_OUTCOMES,
  vsTotalsSchema,
} from "@/lib/vs-performance/match-results.shared";

export const dynamic = "force-dynamic";

const dayResultBodySchema = z
  .object({
    matchupId: z.string().min(1).max(64),
    expectedVersion: z.number().int().min(0),
    requestId: z.string().min(1).max(120),
    totals: vsTotalsSchema.nullable().optional(),
    reportedOutcome: z.enum(VS_OUTCOMES).nullable().optional(),
    finality: z.enum(["unconfirmed", "final"]),
    scope: z.string().min(1).max(200),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ recordedDate: string }> },
) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  const { recordedDate } = await params;
  if (!isVsCalendarDate(recordedDate)) {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  const dateParsed = vsDateSchema.safeParse(recordedDate);
  if (!dateParsed.success) {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }

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
    const input = dayResultBodySchema.parse(body);
    const saved = await saveVsMatchDayResult({
      actor,
      matchupId: input.matchupId,
      recordedDate,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      totals: input.totals ?? null,
      reportedOutcome: input.reportedOutcome ?? null,
      finality: input.finality,
      scope: input.scope,
      evidence: { kind: "hq_manual" },
    });
    return NextResponse.json(saved);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
