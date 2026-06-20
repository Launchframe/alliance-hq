import { NextResponse } from "next/server";

import {
  listSessionAlliances,
  resolveSessionAllianceId,
} from "@/lib/alliance/session-memberships";
import { getOrCreateSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({
        alliances: [],
        currentAllianceId: resolveSessionAllianceId(session),
      });
    }

    const alliances = await listSessionAlliances(session.hqUserId);

    return NextResponse.json({
      alliances,
      currentAllianceId: resolveSessionAllianceId(session),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load alliances",
      },
      { status: 500 },
    );
  }
}
