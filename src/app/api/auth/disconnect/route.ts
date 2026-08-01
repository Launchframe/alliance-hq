import { NextResponse } from "next/server";

import { clearAshedConnection, requireApiSession } from "@/lib/session";

export async function POST() {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
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
