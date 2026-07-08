import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import {
  ChangeHqEmailError,
  confirmHqEmailChange,
  loadHqUserEmailById,
} from "@/lib/auth/change-hq-email.server";
import { resolveSessionHqUserId } from "@/lib/auth/resolve-session-hq-user.server";
import { readSessionId } from "@/lib/session";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const hqUserId = await resolveSessionHqUserId(session);
  if (!hqUserId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const currentEmail =
    (await loadHqUserEmailById(hqUserId)) ?? session.user.email ?? "";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const newEmail =
    typeof body === "object" &&
    body !== null &&
    "newEmail" in body &&
    typeof body.newEmail === "string"
      ? body.newEmail
      : "";
  const code =
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
      ? body.code
      : "";

  try {
    const sessionId = await readSessionId();
    const result = await confirmHqEmailChange({
      hqUserId,
      currentEmail,
      newEmailRaw: newEmail,
      codeRaw: code,
      sessionId,
    });

    await bridgeAuthUserToBrowserSession({
      hqUserId,
      email: result.email,
      displayName: session.user.name,
      // confirmHqEmailChange already set emailVerifiedAt on hq_users.
      markEmailVerified: false,
    });

    return NextResponse.json({ ok: true, email: result.email });
  } catch (error) {
    if (error instanceof ChangeHqEmailError) {
      const status =
        error.code === "email_in_use"
          ? 409
          : error.code === "not_found"
            ? 404
            : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[email-change/confirm]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
