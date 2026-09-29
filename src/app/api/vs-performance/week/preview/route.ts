import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { previewVsWeekPlan } from "@/lib/vs-performance/weekly-plan.server";

export const dynamic = "force-dynamic";

const previewBodySchema = z
  .object({
    draft: z.unknown(),
    expectedVersion: z.number().int().min(0),
    scope: z.string().min(1).max(200),
    reapplyDates: z.array(z.string().max(16)).max(6).optional(),
  })
  .strict();

export async function POST(request: Request) {
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
    const input = previewBodySchema.parse(body);
    const preview = await previewVsWeekPlan(
      actor,
      input.draft,
      input.expectedVersion,
      input.scope,
      input.reapplyDates,
    );
    return NextResponse.json(preview);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
