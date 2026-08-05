import { NextResponse } from "next/server";

import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import {
  getVsInventoryItemDef,
  updateVsInventoryItemDef,
} from "@/lib/vs-calculator/item-defs.server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ defId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { defId } = await context.params;
  const def = await getVsInventoryItemDef(defId);
  if (!def) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    def: {
      ...def,
      createdAt: def.createdAt.toISOString(),
      updatedAt: def.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { defId } = await context.params;
  let body: {
    slug?: string;
    displayName?: string;
    pointsByDay?: Record<string, number>;
    status?: string;
    sortOrder?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const def = await updateVsInventoryItemDef(defId, body);
    if (!def) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({
      def: {
        ...def,
        createdAt: def.createdAt.toISOString(),
        updatedAt: def.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
