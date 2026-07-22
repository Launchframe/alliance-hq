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

export async function GET(_request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const { ashedMemberId } = await context.params;

  try {
    const result = await resolveCommanderDonationStoreUrl(
      session.id,
      ashedMemberId.trim(),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof CommanderDonationError ||
      error instanceof CommanderAccessError
    ) {
      return NextResponse.json(
        { error: error.message, code: "code" in error ? error.code : undefined },
        { status: error.status },
      );
    }
    throw error;
  }
}
