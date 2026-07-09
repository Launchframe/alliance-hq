import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { getSuggestionsForEng } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession !== "Engineer") {
    return NextResponse.json(
      { error: "Only Engineers can view WL suggestions." },
      { status: 403 },
    );
  }

  const suggestions = await getSuggestionsForEng(ctx.allianceId, ctx.commanderId);
  return NextResponse.json({ suggestions });
}
