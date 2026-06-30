import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";

import { runWebMemberLinkPreview } from "@/lib/member-link/orchestrator.server";
import { memberLinkJsonResponse } from "@/lib/member-link/api-response.server";
import { requireMemberLinkSession } from "@/lib/member-link/require-session.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  gameUid: z.string().trim().max(20).optional(),
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
  const result = await runWebMemberLinkPreview({
    allianceId: auth.allianceId,
    hqUserId: auth.hqUserId,
    locale,
    gameUid: body.gameUid,
  });

  return memberLinkJsonResponse(result);
}
