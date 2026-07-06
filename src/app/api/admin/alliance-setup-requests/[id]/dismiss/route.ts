import { NextResponse } from "next/server";

import { dismissAllianceSetupRequest } from "@/lib/alliance/alliance-setup-request.server";
import { getRbacContext } from "@/lib/rbac/context";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** POST /api/admin/alliance-setup-requests/[id]/dismiss */
export async function POST(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { id } = await context.params;
  const requestId = id?.trim();
  if (!requestId) {
    return NextResponse.json({ error: "Request id is required." }, { status: 400 });
  }

  let body: { resolutionNote?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const ctx = await getRbacContext(sessionId);
  const dismissed = await dismissAllianceSetupRequest({
    requestId,
    dismissedByHqUserId: ctx?.hqUserId ?? "",
    resolutionNote: body.resolutionNote,
  });

  if (!dismissed) {
    return NextResponse.json({ error: "Request not found or not open." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
