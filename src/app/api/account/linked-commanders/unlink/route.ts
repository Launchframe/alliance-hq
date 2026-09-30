import { NextResponse } from "next/server";
import { z } from "zod";

import { unlinkOwnCommanderClaim } from "@/lib/member-link/unlink.server";
import { requireApiSession, resolveEffectiveHqUserIdForSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  allianceId: z.string().trim().min(1).max(64),
  ashedMemberId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return sessionOrError;
  }
  const session = sessionOrError;
  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await unlinkOwnCommanderClaim({
    sessionId: session.id,
    hqUserId,
    allianceId: body.allianceId,
    ashedMemberId: body.ashedMemberId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Nothing to unlink.", code: result.reason },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, removed: result.removed });
}
