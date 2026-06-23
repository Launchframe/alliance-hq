import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  PasswordAuthError,
  setPasswordForHqUser,
} from "@/lib/auth/password.server";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof body.password === "string"
      ? body.password
      : "";
  const confirmPassword =
    typeof body === "object" &&
    body !== null &&
    "confirmPassword" in body &&
    typeof body.confirmPassword === "string"
      ? body.confirmPassword
      : password;

  try {
    const hqUserId = await ensureHqUserForAuthEmail(
      session.user.email,
      session.user.name,
    );
    await setPasswordForHqUser({
      hqUserId,
      password,
      confirmPassword,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordAuthError) {
      const status =
        error.code === "invalid_credentials" ? 404 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[password/set]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
