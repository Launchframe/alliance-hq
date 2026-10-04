import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getActivityPrincipalForSession } from "@/lib/activity/access.server";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { handleWebVrCommand, loadMyVrForUser } from "@/lib/vr/web-vr.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    const t = await getTranslations("settings");
    return NextResponse.json({ error: t("allianceRequired") }, { status: 400 });
  }

  const payload = await loadMyVrForUser({
    allianceId,
    hqUserId: session.hqUserId,
  });
  if (!payload) {
    const t = await getTranslations("professions");
    return NextResponse.json(
      { code: "member_link_required", error: t("linkRequired") },
      { status: 403 },
    );
  }

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    const t = await getTranslations("settings");
    return NextResponse.json({ error: t("allianceRequired") }, { status: 400 });
  }

  const principal = await getActivityPrincipalForSession(session);
  if (!principal || principal.currentAllianceId !== allianceId) {
    const t = await getTranslations("activity");
    return NextResponse.json({ error: t("accessChanged") }, { status: 403 });
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
    principal,
    locale,
    explicitInstituteLevel: body.instituteLevel,
    confirm: body.confirm,
  });

  if ("code" in result && result.code === "member_link_required") {
    const t = await getTranslations("professions");
    return NextResponse.json(
      { code: result.code, error: t("linkRequired") },
      { status: 403 },
    );
  }

  return NextResponse.json(result);
}
