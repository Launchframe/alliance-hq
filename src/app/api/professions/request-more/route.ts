import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { requestMoreEngs } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession !== "War Leader") {
    return NextResponse.json(
      { error: "Only War Leaders can request more Engineers." },
      { status: 403 },
    );
  }

  await requestMoreEngs(ctx.allianceId, ctx.commanderId);
  return NextResponse.json({ ok: true });
}
