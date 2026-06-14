import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import {
  isAllowedPermission,
  resolveEntityPermission,
} from "@/lib/bff/catalog";
import {
  forwardJson,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";

type Props = {
  params: Promise<{ entity: string }>;
};

export async function GET(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { entity } = await params;
  const permission = resolveEntityPermission(entity, "GET");
  if (!permission || !isAllowedPermission(permission)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const path = `/entities/${entity}${query ? `?${query}` : ""}`;

  const upstream = await forwardJson(ctx.connection, path, { method: "GET" });
  await writeAuditLog({
    sessionId: ctx.sessionId,
    action: "bff.entity.read",
    resourceType: "entity",
    resourceName: entity,
    metadata: { method: "GET" },
  });

  return sanitizeUpstreamResponse(upstream);
}
