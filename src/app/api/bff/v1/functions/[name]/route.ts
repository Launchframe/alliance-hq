import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { resolveFunctionPermission } from "@/lib/bff/catalog";
import {
  forwardJson,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession } from "@/lib/session";

type Props = {
  params: Promise<{ name: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { name } = await params;
  const permission = resolveFunctionPermission(name);
  const denied = await requireSessionPermission(ctx.sessionId, permission);
  if (!permission || denied) {
    return denied ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();
  const upstream = await forwardJson(ctx.connection, `/functions/${name}`, {
    method: "POST",
    body,
  });

  const session = await loadSession(ctx.sessionId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: session?.allianceId ?? undefined,
    hqUserId: session?.hqUserId ?? undefined,
    action: "bff.function.call",
    resourceType: "function",
    resourceName: name,
    metadata: { method: "POST" },
  });

  return sanitizeUpstreamResponse(upstream);
}
