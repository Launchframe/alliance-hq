import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { syncAshedOpponentInfo } from "@/lib/vs-performance/matchup-sync.server";

export const dynamic = "force-dynamic";

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
    const payload = await syncAshedOpponentInfo(actor, body);
    return NextResponse.json(payload);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
