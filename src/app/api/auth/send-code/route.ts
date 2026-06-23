import { NextResponse } from "next/server";

import {
  AuthEmailCodeError,
  issueAuthEmailCode,
} from "@/lib/auth/email-code.server";

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

  try {
    await issueAuthEmailCode(email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthEmailCodeError) {
      const status = error.code === "rate_limited" ? 429 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[auth/send-code]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
