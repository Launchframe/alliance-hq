import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  resolveCommanderDonationStoreUrl,
} from "@/lib/members/commander-donation.server";
import { CommanderAccessError } from "@/lib/members/commander-access.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ ashedMemberId: string }>;
};

/**
 * Officer gift launch — 302 to Last War. Never JSON `{ url }` so session XSS /
 * client logs cannot scrape `loginToken` from a fetch body.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const { ashedMemberId } = await context.params;
  const id = ashedMemberId.trim();

  try {
    const result = await resolveCommanderDonationStoreUrl(session.id, id);
    return NextResponse.redirect(result.url, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (
      error instanceof CommanderDonationError ||
      error instanceof CommanderAccessError
    ) {
      const dest = new URL(
        `/members/${encodeURIComponent(id)}`,
        request.url,
      );
      const code =
        error instanceof CommanderDonationError ? error.code : "forbidden";
      dest.searchParams.set("donationLaunchError", code);
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
