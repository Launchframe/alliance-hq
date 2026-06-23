import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import { runWebMemberLinkStartOver } from "@/lib/member-link/orchestrator.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  const locale = await getLocale();
  const result = await runWebMemberLinkStartOver({
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
  });

  return NextResponse.json(result);
}
