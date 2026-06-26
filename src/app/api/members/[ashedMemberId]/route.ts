import { NextResponse } from "next/server";

import {
  CommanderAccessError,
} from "@/lib/members/commander-access.server";
import { loadCommanderProfile } from "@/lib/members/commander-profile.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ ashedMemberId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { ashedMemberId } = await params;
    const trimmed = ashedMemberId.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Member id required." }, { status: 400 });
    }

    const profile = await loadCommanderProfile(session.id, trimmed);
    if (!profile) {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof CommanderAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load commander profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
