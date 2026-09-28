import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { vsActorForSession } from "@/lib/vs-performance/api-helpers.server";

export const dynamic = "force-dynamic";

export async function POST() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  return NextResponse.json(
    { error: "ashed_import_unavailable", code: "ashed_import_unavailable" },
    { status: 501 },
  );
}
