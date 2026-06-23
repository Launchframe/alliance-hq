import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { runWebMemberLinkFuzzyPick } from "@/lib/member-link/orchestrator.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";
import { getRbacContext } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  memberId: z.string().trim().min(1).max(64),
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
  const result = await runWebMemberLinkFuzzyPick({
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    userEmail: rbac?.email ?? null,
    displayName: rbac?.displayName ?? null,
    memberId: body.memberId,
  });

  return NextResponse.json(result);
}
