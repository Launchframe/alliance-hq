import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveMemberLinkHelpRequest } from "@/lib/member-link/member-link-help-queue.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
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

  const result = await resolveMemberLinkHelpRequest({
    requestId: id,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
    action: body.action,
    resolutionNote: body.resolutionNote,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, action: body.action });
}
