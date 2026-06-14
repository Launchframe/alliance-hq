import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import {
  decodeIntegrationAction,
  resolveIntegrationPermission,
} from "@/lib/bff/catalog";
import {
  base44Headers,
  base44Url,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession } from "@/lib/session";

type Props = {
  params: Promise<{ action: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { action: encoded } = await params;
  const action = decodeIntegrationAction(encoded);
  const permission = resolveIntegrationPermission(action);
  const denied = await requireSessionPermission(ctx.sessionId, permission);
  if (!permission || denied) {
    return denied ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  const path = `/integration-endpoints/${action}`;
  const url = base44Url(ctx.connection, path);

  let upstream: Response;
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.connection.token}`,
        "X-Origin-Url": ctx.connection.originUrl,
      },
      body: formData,
    });
  } else {
    const body = await request.text();
    upstream = await fetch(url, {
      method: "POST",
      headers: base44Headers(ctx.connection),
      body,
    });
  }

  const session = await loadSession(ctx.sessionId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: session?.allianceId ?? undefined,
    hqUserId: session?.hqUserId ?? undefined,
    action: "bff.integration",
    resourceType: "integration",
    resourceName: action,
  });

  return sanitizeUpstreamResponse(upstream);
}
