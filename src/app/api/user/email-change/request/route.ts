import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  ChangeHqEmailError,
  loadHqUserEmailById,
  requestHqEmailChange,
} from "@/lib/auth/change-hq-email.server";
import { resolveSessionHqUserId } from "@/lib/auth/resolve-session-hq-user.server";

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

  try {
    await requestHqEmailChange({
      hqUserId,
      currentEmail,
      newEmailRaw: newEmail,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ChangeHqEmailError) {
      const status =
        error.code === "rate_limited"
          ? 429
          : error.code === "email_in_use"
            ? 409
            : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[email-change/request]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
