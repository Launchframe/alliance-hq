import { NextResponse } from "next/server";

import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import {
  createVsInventoryItemDef,
  listVsInventoryItemDefs,
} from "@/lib/vs-calculator/item-defs.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const defs = await listVsInventoryItemDefs(
    status ? { status } : undefined,
  );

  return NextResponse.json({
    defs: defs.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

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

  if (!body.slug?.trim() || !body.displayName?.trim()) {
    return NextResponse.json(
      { error: "slug and displayName are required." },
      { status: 400 },
    );
  }

  try {
    const def = await createVsInventoryItemDef({
      slug: body.slug.trim(),
      displayName: body.displayName.trim(),
      pointsByDay: body.pointsByDay ?? {},
      status: body.status,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({
      def: {
        ...def,
        createdAt: def.createdAt.toISOString(),
        updatedAt: def.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
