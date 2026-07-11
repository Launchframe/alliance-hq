import { NextResponse } from "next/server";

import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { setEngCoverageWindow } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await resolveProfessionRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  if (ctx.profession !== "Engineer") {
    return NextResponse.json(
      { error: "Only Engineers can set coverage windows." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as {
    coverageStartHour?: number | null;
    coverageEndHour?: number | null;
  };

  const startHour =
    body.coverageStartHour != null ? Number(body.coverageStartHour) : null;
  const endHour =
    body.coverageEndHour != null ? Number(body.coverageEndHour) : null;

  if (
    (startHour !== null && (isNaN(startHour) || startHour < 0 || startHour > 23)) ||
    (endHour !== null && (isNaN(endHour) || endHour < 0 || endHour > 23))
  ) {
    return NextResponse.json(
      { error: "Coverage hours must be 0–23 (UTC)." },
      { status: 400 },
    );
  }

  try {
    await setEngCoverageWindow(
      ctx.allianceId,
      ctx.commanderId,
      startHour,
      endHour,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
