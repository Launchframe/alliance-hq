import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { swapConductors } from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    dateA?: string;
    dateB?: string;
  };
  const dateA = body.dateA?.trim();
  const dateB = body.dateB?.trim();

  if (!dateA || !dateB) {
    return NextResponse.json(
      { error: "Both dateA and dateB are required." },
      { status: 400 },
    );
  }

  try {
    const { records } = await swapConductors({
      allianceId: ctx.allianceId,
      dateA,
      dateB,
    });
    return NextResponse.json({ records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Swap failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
