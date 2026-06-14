import { NextResponse } from "next/server";

import { loadAllianceMembers } from "@/lib/members/load";
import { getOrCreateSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getOrCreateSession();
    const payload = await loadAllianceMembers(session.id);
    return NextResponse.json(payload);
  } catch (error) {
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
