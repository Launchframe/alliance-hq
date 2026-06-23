import { NextResponse } from "next/server";

import {
  PasswordAuthError,
  registerPasswordAccount,
} from "@/lib/auth/password.server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
      ? body.email
      : "";
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
    const result = await registerPasswordAccount({
      email,
      password,
      confirmPassword,
    });
    return NextResponse.json({ ok: true, email: result.email });
  } catch (error) {
    if (error instanceof PasswordAuthError) {
      const status =
        error.code === "email_taken"
          ? 409
          : error.code === "invalid_email" || error.code === "invalid_password"
            ? 400
            : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[password/register]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
