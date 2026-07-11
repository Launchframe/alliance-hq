import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { linkOAuthAccountForSignedInUser } from "@/lib/auth/account-linking.server";
import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import {
  OAUTH_ACCOUNT_ALREADY_LINKED,
  OAUTH_PROVIDER_TYPE_ALREADY_LINKED,
  oauthAccountLinkErrorRedirect,
} from "@/lib/auth/oauth-link-error-redirect.shared";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

function e2eEnabled(): boolean {
  return process.env.E2E_TEST === "true";
}

function parseProvider(value: string | null): LinkedOAuthProvider | null {
  return value === "google" || value === "discord" ? value : null;
}

/** Allowed return surfaces for signed-in OAuth link (matches oauthAccountLinkErrorRedirect). */
function parseCallbackPath(value: string | null): string {
  const sanitized = sanitizeInternalRedirectPath(value);
  if (sanitized === "/account" || sanitized === "/settings/account") {
    return sanitized;
  }
  return "/settings/account";
}

/**
 * Browser-navigable OAuth completion shim for Playwright.
 * Intercept `/api/auth/signin/{provider}` and redirect here to exercise the
 * same signed-in link path as a real OAuth callback without hitting Google/Discord.
 */
export async function GET(request: Request) {
  if (!e2eEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const provider = parseProvider(url.searchParams.get("provider"));
  const providerAccountId = url.searchParams.get("providerAccountId")?.trim() ?? "";
  const providerEmail = url.searchParams.get("providerEmail")?.trim() || null;
  const callbackPath = parseCallbackPath(url.searchParams.get("callbackPath"));

  if (!provider || !providerAccountId) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    const callback = `${url.pathname}${url.search}`;
    const signIn = new URL("/auth", request.url);
    signIn.searchParams.set("callbackUrl", callback);
    return NextResponse.redirect(signIn);
  }

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
    const linkError =
      result.code === "provider_account_on_other_user"
        ? OAUTH_ACCOUNT_ALREADY_LINKED
        : OAUTH_PROVIDER_TYPE_ALREADY_LINKED;
    const redirectPath = oauthAccountLinkErrorRedirect(callbackPath, linkError);
    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  const success = new URL(callbackPath, request.url);
  success.searchParams.set("linked", provider);
  return NextResponse.redirect(success);
}
