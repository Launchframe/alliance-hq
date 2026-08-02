import { NextResponse } from "next/server";

import {
  listAlliancePickerOptions,
  resolveSessionAllianceId,
} from "@/lib/alliance/session-memberships";
import { getRbacContext } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";

export async function GET() {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    if (!session.hqUserId) {
      return NextResponse.json({
        alliances: [],
        currentAllianceId: resolveSessionAllianceId(session),
        isPlatformMaintainer: false,
      });
    }

    const rbac = await getRbacContext(session.id);
    const isPlatformMaintainer = rbac?.isPlatformMaintainer ?? false;
    const alliances = await listAlliancePickerOptions(session.hqUserId);

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
