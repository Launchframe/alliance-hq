import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { parseBagImage } from "@/lib/vs-calculator/bag-ocr/parse-bag-image.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "image field is required." }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Image must be under 20 MB." },
      { status: 413 },
    );
  }

  try {
    const buffer = Buffer.from(await image.arrayBuffer());
    const result = await parseBagImage(buffer);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[vs-calculator/inventory/parse]", err);
    return NextResponse.json(
      { error: "Could not read the bag screenshot." },
      { status: 500 },
    );
  }
}
