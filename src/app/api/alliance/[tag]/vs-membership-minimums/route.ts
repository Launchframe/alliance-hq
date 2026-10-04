import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { AllianceRouteError, resolveAllianceRouteForSession } from "@/lib/alliance/alliance-route-context.server";
import { VS_COMPLIANCE_SETTINGS_PERMISSION } from "@/lib/rbac/constants";
import { requireApiSession } from "@/lib/session";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { loadVsMembershipSettings, saveVsMembershipSettings } from "@/lib/vs-compliance/policy.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ tag: string }> };

async function errorResponse(error: unknown) {
  const t = await getTranslations();
  const status = error instanceof VsComplianceError || error instanceof AllianceRouteError ? error.status : 500;
  const code = error instanceof VsComplianceError ? error.code : "request_failed";
  const key = status === 403 ? "hotkeys.permissionRequired" : code === "changed" ? "vsCompliance.changed" : "statSync.actionFailed";
  return NextResponse.json({ code, error: t(key) }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsComplianceError("forbidden", 403);
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);
    const settings = await loadVsMembershipSettings(session.id, alliance.allianceId);
    let canManage = false;
    try {
      await requireVsComplianceAccess(session.id, alliance.allianceId, VS_COMPLIANCE_SETTINGS_PERMISSION);
      canManage = true;
    } catch (error) {
      if (!(error instanceof VsComplianceError) || error.code !== "forbidden") throw error;
    }
    return NextResponse.json({ ...settings, canManage, allianceTag: alliance.tag, allianceName: alliance.name });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsComplianceError("forbidden", 403);
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);
    let body: unknown;
    try { body = await request.json(); } catch { throw new VsComplianceError("invalid_policy"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new VsComplianceError("invalid_policy");
    const { expectedVersion, ...patch } = body as Record<string, unknown>;
    const saved = await saveVsMembershipSettings(session.id, alliance.allianceId, { expectedVersion, patch });
    return NextResponse.json({ latest: saved, canManage: true });
  } catch (error) {
    return errorResponse(error);
  }
}
