import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { parseThpBreakdownInput } from "@/lib/thp/breakdown.shared";
import { handleWebThpCommand, loadMyThpForUser } from "@/lib/thp/web-thp.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const payload = await loadMyThpForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!payload) {
    return NextResponse.json(
      { code: "member_link_required", error: "Link your commander first." },
      { status: 403 },
    );
  }

  return NextResponse.json(payload);
}

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
    const screenshotBuffer =
      screenshot instanceof File ? Buffer.from(await screenshot.arrayBuffer()) : null;

    const result = await handleWebThpCommand({
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
    breakdown?: unknown;
    confirm?: "yes" | "no" | null;
  };

  const result = await handleWebThpCommand({
    allianceId,
    hqUserId: session.hqUserId,
    locale,
    total: body.total,
    breakdown: parseThpBreakdownInput(body.breakdown),
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
