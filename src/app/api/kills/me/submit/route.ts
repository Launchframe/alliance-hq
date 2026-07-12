import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { handleWebKillsCommand } from "@/lib/kills/web-kills.server";
import {
  MAX_SCREENSHOT_UPLOAD_BYTES,
  SCREENSHOT_TOO_LARGE_ERROR,
} from "@/lib/ocr/screenshot-upload.shared";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** Screenshot OCR can be slow on cold start. */
export const maxDuration = 60;

/** Mutations only — JSON total / confirm, or multipart screenshot. */
export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const locale = await getLocale();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const screenshot = form.get("screenshot");
    const confirmRaw = form.get("confirm");
    const confirm =
      confirmRaw === "yes" || confirmRaw === "no" ? confirmRaw : null;

    if (screenshot instanceof File && screenshot.size > MAX_SCREENSHOT_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: SCREENSHOT_TOO_LARGE_ERROR },
        { status: 413 },
      );
    }

    const screenshotBuffer =
      screenshot instanceof File
        ? Buffer.from(await screenshot.arrayBuffer())
        : null;

    const result = await handleWebKillsCommand({
      allianceId,
      hqUserId: session.hqUserId,
      locale,
      confirm,
      screenshotBuffer,
    });
    if ("code" in result && result.code === "member_link_required") {
      return NextResponse.json(
        { code: result.code, error: "Link your commander first." },
        { status: 403 },
      );
    }
    return NextResponse.json(result);
  }

  const body = (await request.json()) as {
    total?: number | null;
    confirm?: "yes" | "no" | null;
  };

  const result = await handleWebKillsCommand({
    allianceId,
    hqUserId: session.hqUserId,
    locale,
    total: body.total,
    confirm: body.confirm,
  });

  if ("code" in result && result.code === "member_link_required") {
    return NextResponse.json(
      { code: result.code, error: "Link your commander first." },
      { status: 403 },
    );
  }

  return NextResponse.json(result);
}
