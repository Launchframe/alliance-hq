import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { dismissEng, selfRemoveEng } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/professions/dismiss
 *
 * WL dismissing an Eng: body must include { engCommanderId }
 * Eng self-removing: body may be empty (uses caller's commanderId)
 */
export async function POST(request: Request) {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { engCommanderId?: string };

  if (ctx.profession === "War Leader") {
    if (!body.engCommanderId?.trim()) {
      return NextResponse.json(
        { error: "engCommanderId is required for WL dismissal." },
        { status: 400 },
      );
    }
    try {
      await dismissEng({
        allianceId: ctx.allianceId,
        wlCommanderId: ctx.commanderId,
        engCommanderId: body.engCommanderId,
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dismissal failed.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (ctx.profession === "Engineer") {
    try {
      await selfRemoveEng(ctx.allianceId, ctx.commanderId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove from team.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "No profession assigned." }, { status: 400 });
}
