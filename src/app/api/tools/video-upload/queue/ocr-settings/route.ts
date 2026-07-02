import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
import {
  isAllianceHqOcrOnlyLockedOnDeploy,
  loadEffectiveAllianceHqOcrOnly,
  setAllianceHqOcrOnly,
} from "@/lib/video/alliance-ocr-settings.server";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getOrCreateSession();

    if (!(await sessionCanReadAllianceVideoQueue(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allianceId = session.currentAllianceId;
    if (!allianceId) {
      return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
    }

    const [hqOcrOnly, canManage] = await Promise.all([
      loadEffectiveAllianceHqOcrOnly(allianceId),
      sessionCanProcessVideo(session.id),
    ]);

    return NextResponse.json({
      hqOcrOnly,
      hqOcrOnlyLocked: isAllianceHqOcrOnlyLockedOnDeploy(),
      canManage,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load OCR settings",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getOrCreateSession();

    if (!(await sessionCanProcessVideo(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allianceId = session.currentAllianceId;
    if (!allianceId) {
      return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
    }

    const body = (await request.json()) as { hqOcrOnly?: unknown };
    if (typeof body.hqOcrOnly !== "boolean") {
      return NextResponse.json(
        { error: "hqOcrOnly must be a boolean." },
        { status: 400 },
      );
    }

    if (isAllianceHqOcrOnlyLockedOnDeploy() && !body.hqOcrOnly) {
      return NextResponse.json(
        { error: "Ashed OCR is not available on this server." },
        { status: 409 },
      );
    }

    await setAllianceHqOcrOnly(allianceId, body.hqOcrOnly);

    const effectiveHqOcrOnly = await loadEffectiveAllianceHqOcrOnly(allianceId);

    return NextResponse.json({
      hqOcrOnly: effectiveHqOcrOnly,
      hqOcrOnlyLocked: isAllianceHqOcrOnlyLockedOnDeploy(),
      canManage: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save OCR settings",
      },
      { status: 500 },
    );
  }
}
