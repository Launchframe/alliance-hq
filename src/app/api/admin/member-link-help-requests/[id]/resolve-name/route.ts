import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveClaimNameReview } from "@/lib/member-link/member-link-help-review.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chosen: z.enum(["roster", "lookup"]),
});

type Props = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requirePlatformMaintainer(session.id);
  if (denied) return denied;

  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await resolveClaimNameReview({
    requestId: id,
    chosen: body.chosen,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
    ashedConnection: await getAshedConnection(session.id),
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_closed"
          ? 409
          : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, memberName: result.memberName });
}
