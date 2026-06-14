import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { resolveEntityPermission } from "@/lib/bff/catalog";
import {
  forwardJson,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession } from "@/lib/session";

type Props = {
  params: Promise<{ entity: string }>;
};

export async function GET(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { entity } = await params;
  const permission = resolveEntityPermission(entity, "GET");
  const denied = await requireSessionPermission(ctx.sessionId, permission);
  if (!permission || denied) {
    return denied ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const path = `/entities/${entity}${query ? `?${query}` : ""}`;

  const upstream = await forwardJson(ctx.connection, path, { method: "GET" });
  const session = await loadSession(ctx.sessionId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: session?.allianceId ?? undefined,
    hqUserId: session?.hqUserId ?? undefined,
    action: "bff.entity.read",
    resourceType: "entity",
    resourceName: entity,
    metadata: { method: "GET" },
  });

  return sanitizeUpstreamResponse(upstream);
}

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { entity } = await params;
  const permission = resolveEntityPermission(entity, "POST");
  const denied = await requireSessionPermission(ctx.sessionId, permission);
  if (!permission || denied) {
    return denied ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();
  const upstream = await forwardJson(ctx.connection, `/entities/${entity}`, {
    method: "POST",
    body,
  });

  const session = await loadSession(ctx.sessionId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: session?.allianceId ?? undefined,
    hqUserId: session?.hqUserId ?? undefined,
    action: "bff.entity.write",
    resourceType: "entity",
    resourceName: entity,
    metadata: { method: "POST" },
  });

  return sanitizeUpstreamResponse(upstream);
}
