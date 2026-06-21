import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthSession } from "@/lib/auth";
import {
  acceptHqInvite,
  resolveHqInviteAcceptRedirect,
} from "@/lib/native-alliance/invites";
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
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const authSession = await requireAuthSession();
  if (!authSession?.user?.id || !authSession.user.email) {
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
    if (
      error instanceof Error &&
      error.message === "Email does not match this invite."
    ) {
      return NextResponse.json({ code: "email_mismatch" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Accept failed." },
      { status: 400 },
    );
  }
}
