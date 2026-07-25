/**
 * GET /api/officer-intel/sessions/[id]/images/[imageId]
 */

import { NextResponse } from "next/server";

import {
  getOfficerChatSessionImageForAlliance,
} from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
} from "@/lib/officer-intel/route-helpers.server";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; imageId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { id, imageId } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  const image = await getOfficerChatSessionImageForAlliance({
    sessionId: id,
    allianceId: context.allianceId,
    imageId,
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const buffer = await getObject(image.storageKey);
  const contentType = image.storageKey.endsWith(".jpg")
    ? "image/jpeg"
    : image.storageKey.endsWith(".webp")
      ? "image/webp"
      : "image/png";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
