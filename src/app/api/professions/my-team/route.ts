import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { getMyEngTeam, getMyWlTeam } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession === "Engineer") {
    const data = await getMyEngTeam(ctx.allianceId, ctx.commanderId);
    return NextResponse.json({ profession: "Engineer", ...data });
  }

  if (ctx.profession === "War Leader") {
    const data = await getMyWlTeam(ctx.allianceId, ctx.commanderId);
    return NextResponse.json({ profession: "War Leader", ...data });
  }

  return NextResponse.json({
    profession: ctx.profession,
    message: "No profession assigned. Use /switch-profession to set yours.",
  });
}
