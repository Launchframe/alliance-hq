import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { runWebMemberLinkWalkthroughDone } from "@/lib/member-link/orchestrator.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";
import { getRbacContext } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  const locale = await getLocale();
  const rbac = await getRbacContext(auth.session.id);
  const result = await runWebMemberLinkWalkthroughDone({
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    userEmail: rbac?.email ?? null,
    displayName: rbac?.displayName ?? null,
  });

  return NextResponse.json(result);
}
