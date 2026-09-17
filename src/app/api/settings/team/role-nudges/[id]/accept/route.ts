import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  MemberRoleNudgeError,
  acceptMemberRoleNudge,
} from "@/lib/member-role-nudges/actions.server";
import { getRbacContext } from "@/lib/rbac/context";
import { resolveAllianceSettingsAccess } from "@/lib/settings/alliance-settings-access.server";
import { loadSession, readSessionId } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveAllianceSettingsAccess(session);
  if (access.kind !== "ready") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rbac = await getRbacContext(sessionId);
  if (!rbac) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allianceId = resolveSessionAllianceId(access.session);
  if (!allianceId) {
    return NextResponse.json(
      { error: "Alliance context required." },
      { status: 400 },
    );
  }

  const { id: nudgeId } = await context.params;
  const origin = new URL(request.url).origin;

  try {
    const result = await acceptMemberRoleNudge({
      allianceId,
      nudgeId,
      ctx: rbac,
      origin,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MemberRoleNudgeError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "CONFLICT" || error.code === "LAST_OFFICER"
              ? 409
              : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Accept failed.",
      },
      { status: 400 },
    );
  }
}
