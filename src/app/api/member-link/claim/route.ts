import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { runWebMemberLinkClaimConfirm } from "@/lib/member-link/claim.server";
import { memberLinkJsonResponse } from "@/lib/member-link/api-response.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";
import { getRbacContext } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  gameUid: z.string().trim().min(1).max(20),
});

export async function POST(request: Request) {
  const auth = await requireMemberLinkSession();
  if ("error" in auth) return auth.error;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const locale = await getLocale();
  const rbac = await getRbacContext(auth.session.id);
  const result = await runWebMemberLinkClaimConfirm({
    sessionId: auth.session.id,
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    gameUid: body.gameUid,
    userEmail: rbac?.email ?? null,
    displayName: rbac?.displayName ?? null,
  });

  return memberLinkJsonResponse(result);
}
