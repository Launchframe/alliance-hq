import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { handleWebVrCommand, loadMyVrForUser } from "@/lib/vr/web-vr.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const payload = await loadMyVrForUser({
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

  const body = (await request.json()) as {
    instituteLevel?: number | null;
    confirm?: "yes" | "no" | null;
  };

  const locale = await getLocale();
  const result = await handleWebVrCommand({
    sessionId: session.id,
    allianceId,
    hqUserId: session.hqUserId,
    locale,
    explicitInstituteLevel: body.instituteLevel,
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
