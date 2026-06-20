import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import { redeemAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import { resolvePostInviteOnboardingRedirect } from "@/lib/navigation/safe-redirect.shared";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const authSession = await requireAuthSession();
  if (!authSession?.user?.id) {
    return NextResponse.json(
      { code: "auth_required", error: "Sign in required." },
      { status: 401 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const session = await getOrCreateSession();

  try {
    const result = await redeemAllianceJoinCode({
      code: body.code,
      hqUserId: authSession.user.id,
      sessionId: session.id,
      userLabel: authSession.user.email ?? null,
    });

    return NextResponse.json({
      ok: true,
      redirectTo: resolvePostInviteOnboardingRedirect({}),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not redeem join code.",
      },
      { status: 400 },
    );
  }
}
