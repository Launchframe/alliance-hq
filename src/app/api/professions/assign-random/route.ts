import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { assignEngToRandomWl } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession !== "Engineer") {
    return NextResponse.json(
      { error: "Only Engineers can use random assignment." },
      { status: 403 },
    );
  }

  try {
    const result = await assignEngToRandomWl(ctx.allianceId, ctx.commanderId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignment failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
