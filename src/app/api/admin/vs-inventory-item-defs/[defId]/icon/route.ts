import { NextResponse } from "next/server";

import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getObject } from "@/lib/storage";
import {
  getVsInventoryItemDef,
  uploadVsInventoryItemIcon,
} from "@/lib/vs-calculator/item-defs.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ICON_BYTES = 2 * 1024 * 1024;

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
  if (!def?.iconTemplateUrl) {
    return NextResponse.json({ error: "No icon." }, { status: 404 });
  }

  try {
    const buffer = await getObject(def.iconTemplateUrl);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Icon not found." }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { defId } = await context.params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const icon = formData.get("icon");
  if (!(icon instanceof File) || icon.size === 0) {
    return NextResponse.json({ error: "icon file is required." }, { status: 400 });
  }
  if (icon.size > MAX_ICON_BYTES) {
    return NextResponse.json(
      { error: "Icon must be under 2 MB." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await icon.arrayBuffer());
  const updated = await uploadVsInventoryItemIcon({
    defId,
    iconPng: buffer,
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    def: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
