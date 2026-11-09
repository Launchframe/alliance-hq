import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import { redeemAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import { MembershipRejoinRequiresFreshInviteError } from "@/lib/native-alliance/provision-membership";
import { resolvePostInviteOnboardingRedirect } from "@/lib/navigation/safe-redirect.shared";
import { requireApiSession } from "@/lib/session";

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

  const sessionOrError = await requireApiSession();


  if (sessionOrError instanceof NextResponse) return sessionOrError;


  const session = sessionOrError;

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
    if (error instanceof MembershipRejoinRequiresFreshInviteError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not redeem join code.",
      },
      { status: 400 },
    );
  }
}
