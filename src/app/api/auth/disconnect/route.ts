import { NextResponse } from "next/server";

import { getOrCreateSession, clearAshedConnection } from "@/lib/session";

export async function POST() {
  try {
    const session = await getOrCreateSession();
    await clearAshedConnection(session.id);
    return NextResponse.json({ ok: true, isConnected: false });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to disconnect",
      },
      { status: 500 },
    );
  }
}
