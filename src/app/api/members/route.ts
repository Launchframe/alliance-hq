import { NextResponse } from "next/server";

import {
  assertCommanderReadAccess,
  CommanderAccessError,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { loadAllianceMembers } from "@/lib/members/load";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getOrCreateSession();
    const { allianceId } = await resolveCommanderSessionContext(session.id);
    await assertCommanderReadAccess(session.id, allianceId);

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const includeFormer = url.searchParams.get("includeFormer") === "1";

    const refresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";

    const payload = await loadAllianceMembers(session.id, {
      q,
      includeFormer,
      refresh,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof CommanderAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load members";
    const status = message.includes("Not connected")
      ? 401
      : message.includes("Alliance tag")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
