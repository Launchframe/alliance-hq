import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { resolveBulkPermission } from "@/lib/bff/catalog";
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

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { entity } = await params;
  const permission = resolveBulkPermission(entity);
  const denied = await requireSessionPermission(ctx.sessionId, permission);
  if (!permission || denied) {
    return denied ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();
  const upstream = await forwardJson(ctx.connection, `/entities/${entity}/bulk`, {
    method: "POST",
    body,
  });

  const session = await loadSession(ctx.sessionId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: session?.allianceId ?? undefined,
    hqUserId: session?.hqUserId ?? undefined,
    action: "bff.entity.bulk_write",
    resourceType: "entity",
    resourceName: entity,
    metadata: {
      rowCount: (() => {
        try {
          const parsed = JSON.parse(body) as unknown;
          return Array.isArray(parsed) ? parsed.length : 1;
        } catch {
          return null;
        }
      })(),
    },
  });

  return sanitizeUpstreamResponse(upstream);
}
