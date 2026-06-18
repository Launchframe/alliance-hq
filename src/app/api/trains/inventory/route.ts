import { NextResponse } from "next/server";

import { listInventoryItems } from "@/lib/trains/repository";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const items = await listInventoryItems();
  return NextResponse.json({ items });
}
