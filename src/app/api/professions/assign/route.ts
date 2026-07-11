import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { assignEngToWl } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession !== "Engineer") {
    return NextResponse.json(
      { error: "Only Engineers can request assignment to a War Leader." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { wlCommanderId?: string };
  if (!body.wlCommanderId?.trim()) {
    return NextResponse.json(
      { error: "wlCommanderId is required." },
      { status: 400 },
    );
  }

  try {
    const result = await assignEngToWl({
      allianceId: ctx.allianceId,
      engCommanderId: ctx.commanderId,
      wlCommanderId: body.wlCommanderId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignment failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
