import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { switchProfession, updateCommanderProfession } from "@/lib/professions/service";
import type { Profession } from "@/lib/professions/types";

export const dynamic = "force-dynamic";

const VALID_PROFESSIONS: Profession[] = ["Engineer", "War Leader"];

export async function POST(request: Request) {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { toProfession?: string };
  const toProfession = body.toProfession as Profession;

  if (!VALID_PROFESSIONS.includes(toProfession)) {
    return NextResponse.json(
      { error: "toProfession must be 'Engineer' or 'War Leader'." },
      { status: 400 },
    );
  }

  if (!ctx.profession) {
    await updateCommanderProfession(ctx.commanderId, toProfession);
    return NextResponse.json({ ok: true, toProfession });
  }

  if (ctx.profession === toProfession) {
    return NextResponse.json(
      { error: "Already assigned this profession." },
      { status: 400 },
    );
  }

  const fromProfession = ctx.profession as Profession;

  try {
    const result = await switchProfession({
      allianceId: ctx.allianceId,
      commanderId: ctx.commanderId,
      fromProfession,
      toProfession,
    });
    return NextResponse.json({ ok: true, toProfession, freedEngs: result.freedEngs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Switch failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
