import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import {
  isAllowedPermission,
  resolveFunctionPermission,
} from "@/lib/bff/catalog";
import {
  forwardJson,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";

type Props = {
  params: Promise<{ name: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { name } = await params;
  const permission = resolveFunctionPermission(name);
  if (!permission || !isAllowedPermission(permission)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();
  const upstream = await forwardJson(ctx.connection, `/functions/${name}`, {
    method: "POST",
    body,
  });

  await writeAuditLog({
    sessionId: ctx.sessionId,
    action: "bff.function.call",
    resourceType: "function",
    resourceName: name,
    metadata: { method: "POST" },
  });

  return sanitizeUpstreamResponse(upstream);
}
