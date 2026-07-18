import { NextResponse } from "next/server";

import {
  CommanderDonationError,
  resolvePublicTipStoreUrl,
} from "@/lib/members/commander-donation.server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params;
  try {
    const result = await resolvePublicTipStoreUrl(code);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CommanderDonationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
