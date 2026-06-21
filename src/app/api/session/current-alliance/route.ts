import { NextResponse } from "next/server";
import { z } from "zod";

import { switchSessionCurrentAlliance } from "@/lib/alliance/session-memberships";
import { getOrCreateSession } from "@/lib/session";

const patchSchema = z.object({
  allianceId: z.string().trim().min(1),
});

export async function PATCH(request: Request) {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json(
        { error: "Sign in required to switch alliance." },
        { status: 401 },
      );
    }

    const body = patchSchema.parse(await request.json());
    const result = await switchSessionCurrentAlliance(session, body.allianceId);

    return NextResponse.json({
      ok: true,
      currentAllianceId: result.allianceId,
      tag: result.tag,
      name: result.name,
      operatingMode: result.operatingMode,
      redirectPath: result.redirectPath,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to switch alliance";
    const status =
      message.includes("do not have access") ||
      message.includes("HQ user required")
        ? 403
        : message.includes("not found")
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
