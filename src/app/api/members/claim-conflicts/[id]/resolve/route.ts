import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveClaimConflict } from "@/lib/member-link/claim-conflict-queue.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  action: z.enum(["resolve", "dismiss"]),
  resolutionNote: z.string().trim().max(500).optional(),
});

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await resolveClaimConflict({
    id,
    allianceId,
    status: body.action === "dismiss" ? "dismissed" : "resolved",
    resolvedByHqUserId: session.hqUserId,
    resolutionNote: body.resolutionNote ?? null,
    sessionId: session.id,
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, action: body.action });
}
