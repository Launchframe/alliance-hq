import { NextResponse } from "next/server";

import { revokeAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ allianceId: string; joinCodeId: string }> },
) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { joinCodeId } = await context.params;

  try {
    await revokeAllianceJoinCode(joinCodeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not revoke join code.",
      },
      { status: 400 },
    );
  }
}
