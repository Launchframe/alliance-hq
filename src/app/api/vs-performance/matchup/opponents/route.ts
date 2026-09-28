import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { listPreviousVsOpponents } from "@/lib/vs-performance/matchup-sync.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  try {
    const opponents = await listPreviousVsOpponents(actor);
    return NextResponse.json({ opponents });
  } catch (error) {
    return vsErrorResponse(error);
  }
}
