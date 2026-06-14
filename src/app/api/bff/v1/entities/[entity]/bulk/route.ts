import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import {
  isAllowedPermission,
  resolveBulkPermission,
} from "@/lib/bff/catalog";
import {
  forwardJson,
  requireBffSession,
  sanitizeUpstreamResponse,
} from "@/lib/bff/session";

type Props = {
  params: Promise<{ entity: string }>;
};

export async function POST(request: Request, { params }: Props) {
  const ctx = await requireBffSession();
  if (ctx instanceof NextResponse) return ctx;

  const { entity } = await params;
  const permission = resolveBulkPermission(entity);
  if (!permission || !isAllowedPermission(permission)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.text();
  const upstream = await forwardJson(ctx.connection, `/entities/${entity}/bulk`, {
    method: "POST",
    body,
  });

  await writeAuditLog({
    sessionId: ctx.sessionId,
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
