import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  findHqUserIdForOAuthAccount,
  linkOAuthAccountForSignedInUser,
} from "@/lib/auth/account-linking.server";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";

function e2eEnabled(): boolean {
  return process.env.E2E_TEST === "true";
}

function parseProvider(value: unknown): LinkedOAuthProvider | null {
  return value === "google" || value === "discord" ? value : null;
}

export async function POST(request: Request) {
  if (!e2eEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action =
    typeof body === "object" &&
    body !== null &&
    "action" in body &&
    typeof body.action === "string"
      ? body.action
      : "";

  const provider = parseProvider(
    typeof body === "object" && body !== null && "provider" in body
      ? body.provider
      : null,
  );
  const providerAccountId =
    typeof body === "object" &&
    body !== null &&
    "providerAccountId" in body &&
    typeof body.providerAccountId === "string"
      ? body.providerAccountId.trim()
      : "";

  if (!provider || !providerAccountId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (action === "resolve_owner") {
    const hqUserId = await findHqUserIdForOAuthAccount({
      provider,
      providerAccountId,
    });
    return NextResponse.json({ hqUserId });
  }

  if (action === "signed_in_link") {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }

    const providerEmail =
      typeof body === "object" &&
      body !== null &&
      "providerEmail" in body &&
      typeof body.providerEmail === "string"
        ? body.providerEmail
        : null;

    const result = await linkOAuthAccountForSignedInUser({
      hqUserId: session.user.id,
      account: {
        type: "oauth",
        provider,
        providerAccountId,
      },
      providerEmail,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
