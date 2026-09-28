import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { commitVsCaptureReview } from "@/lib/vs-performance/vs-capture.server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  const { reviewId } = await params;
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
    return NextResponse.json(await commitVsCaptureReview(actor, reviewId, body));
  } catch (error) {
    return vsErrorResponse(error);
  }
}
