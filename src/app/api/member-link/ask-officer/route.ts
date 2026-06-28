import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { runWebMemberLinkAskOfficer } from "@/lib/member-link/orchestrator.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";
import { getRbacContext } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  let reportedName: string | undefined;
  let gameUid: string | undefined;
  try {
    const body = (await request.json()) as {
      reportedName?: unknown;
      gameUid?: unknown;
    };
    if (typeof body.reportedName === "string") {
      reportedName = body.reportedName;
    }
    if (typeof body.gameUid === "string") {
      gameUid = body.gameUid;
    }
  } catch {
    // Empty body is allowed when a roster-miss or walkthrough pending state exists.
  }

  const locale = await getLocale();
  const rbac = await getRbacContext(auth.session.id);
  const result = await runWebMemberLinkAskOfficer({
    sessionId: auth.session.id,
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    userEmail: rbac?.email ?? null,
    displayName: rbac?.displayName ?? null,
    reportedName,
    gameUid,
  });

  return NextResponse.json(result);
}
