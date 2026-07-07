import { NextResponse } from "next/server";

import { resolveEmailSignInRestrictionForEmail } from "@/lib/auth/email-sign-in-restriction.server";

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

  const restriction = await resolveEmailSignInRestrictionForEmail(email);
  if (restriction.blocked) {
    return NextResponse.json(
      {
        error: "oauth_sign_in_required",
        email: restriction.email,
        linkedProviders: restriction.linkedProviders,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
