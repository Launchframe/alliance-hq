import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  resolvePublicTipStoreUrl,
} from "@/lib/members/commander-donation.server";
import { isBrowserDocumentNavigation } from "@/lib/members/store-launch-navigation.shared";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

/**
 * Browser navigations only — 302 to Last War. Never JSON `{ url }` (that would
 * exfiltrate `LAST_WAR_STORE_LOGIN_TOKEN` + recipient UID to anyone with a tip code).
 */
export async function GET(request: Request, context: RouteContext) {
  if (!isBrowserDocumentNavigation(request)) {
    return new NextResponse("Launch requires a browser navigation.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { code } = await context.params;
  const trimmed = code.trim();
  try {
    const result = await resolvePublicTipStoreUrl(trimmed);
    return NextResponse.redirect(result.url, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CommanderDonationError) {
      const dest = new URL(`/b/${encodeURIComponent(trimmed || code)}`, request.url);
      dest.searchParams.set("launchError", error.code);
      return NextResponse.redirect(dest, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }
    throw error;
  }
}
