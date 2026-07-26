import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import {
  acceptHqInvite,
  resolveHqInviteAcceptRedirect,
} from "@/lib/native-alliance/invites";
import { auditInviteAcceptFailed } from "@/lib/onboarding/onboarding-audit.server";
import {
  inviteAcceptReasonFromApiCode,
  inviteAcceptReasonFromMessage,
} from "@/lib/onboarding/invite-accept-reasons.shared";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().trim().email().optional(),
  displayName: z.string().trim().max(120).optional(),
  passphrase: z.string().trim().max(120).optional(),
  next: z.string().trim().max(512).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    const session = await getOrCreateSession().catch(() => null);
    await auditInviteAcceptFailed({
      sessionId: session?.id,
      reasonCode: "invalid_body",
    });
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const authSession = await requireAuthSession();
  if (!authSession?.user?.id || !authSession.user.email) {
    const session = await getOrCreateSession().catch(() => null);
    await auditInviteAcceptFailed({
      sessionId: session?.id,
      reasonCode: "auth_required",
    });
    return NextResponse.json(
      { code: "auth_required", error: "Sign in required." },
      { status: 401 },
    );
  }

  const session = await getOrCreateSession();

  try {
    const result = await acceptHqInvite({
      token: decodeURIComponent(token),
      sessionId: session.id,
      hqUserId: authSession.user.id,
      userEmail: authSession.user.email,
      email: body.email,
      displayName: body.displayName,
      passphrase: body.passphrase,
    });

    return NextResponse.json({
      ok: true,
      redirectTo: resolveHqInviteAcceptRedirect({
        queryNext: body.next,
        storedPath: result.redirectPath,
      }),
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Accept failed.";
    const reasonCode =
      message === "Email does not match this invite."
        ? inviteAcceptReasonFromApiCode("email_mismatch")
        : inviteAcceptReasonFromMessage(message);

    await auditInviteAcceptFailed({
      sessionId: session.id,
      hqUserId: authSession.user.id,
      reasonCode,
    });

    if (message === "Email does not match this invite.") {
      return NextResponse.json({ code: "email_mismatch" }, { status: 400 });
    }
    if (message === "This invite belongs to another account.") {
      return NextResponse.json(
        { code: "invite_belongs_to_other_account", error: message },
        { status: 400 },
      );
    }
    if (message === "Sign in with Discord to accept this invite.") {
      return NextResponse.json(
        { code: "discord_login_required", error: message },
        { status: 400 },
      );
    }
    if (message === "Discord account does not match this invite.") {
      return NextResponse.json(
        { code: "discord_user_mismatch", error: message },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
