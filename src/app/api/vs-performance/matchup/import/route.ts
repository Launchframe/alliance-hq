import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { pullAshedOpponentInfo } from "@/lib/vs-performance/matchup-sync.server";
import { vsWeekStartSchema } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";

const pullBodySchema = z
  .object({
    weekStart: vsWeekStartSchema,
    scope: z.string().min(1).max(200),
    reason: z.enum(["auto", "refresh"]).default("refresh"),
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
    const input = pullBodySchema.parse(body);
    const payload = await pullAshedOpponentInfo(
      actor,
      input.weekStart,
      input.scope,
      input.reason,
    );
    return NextResponse.json(payload);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
