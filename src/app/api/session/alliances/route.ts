import { NextResponse } from "next/server";

import {
  listAlliancePickerOptions,
  resolveSessionAllianceId,
} from "@/lib/alliance/session-memberships";
import { getRbacContext } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({
        alliances: [],
        currentAllianceId: resolveSessionAllianceId(session),
        isPlatformMaintainer: false,
      });
    }

    const rbac = await getRbacContext(session.id);
    const isPlatformMaintainer = rbac?.isPlatformMaintainer ?? false;
    const alliances = await listAlliancePickerOptions(
      session.hqUserId,
      isPlatformMaintainer,
    );

    return NextResponse.json({
      alliances,
      currentAllianceId: resolveSessionAllianceId(session),
      isPlatformMaintainer,
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
