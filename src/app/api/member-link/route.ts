import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import {
  getWebMemberLinkStatus,
  runWebMemberLinkSubmit,
} from "@/lib/member-link/orchestrator.server";
import { memberLinkJsonResponse } from "@/lib/member-link/api-response.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";
import { getRbacContext } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  const locale = await getLocale();
  const status = await getWebMemberLinkStatus({
    sessionId: auth.session.id,
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
  });

  return NextResponse.json(status);
}

const submitSchema = z.object({
  reportedName: z.string().trim().min(1).max(120).optional(),
  gameUid: z.string().trim().max(20).optional(),
  ownerProvidedServerNumber: z.number().int().positive().max(9999).optional(),
  ownerLookupFallback: z.boolean().optional(),
  allianceHomeConfirmed: z.boolean().optional(),
  userClaimedLookupAsHome: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const locale = await getLocale();
  const rbac = await getRbacContext(auth.session.id);
  const result = await runWebMemberLinkSubmit({
    sessionId: auth.session.id,
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    userEmail: rbac?.email ?? null,
    displayName: rbac?.displayName ?? null,
    reportedName: body.reportedName,
    gameUid: body.gameUid,
    ownerProvidedServerNumber: body.ownerProvidedServerNumber,
    ownerLookupFallback: body.ownerLookupFallback,
    allianceHomeConfirmed: body.allianceHomeConfirmed,
    userClaimedLookupAsHome: body.userClaimedLookupAsHome,
  });

  return memberLinkJsonResponse(result);
}
