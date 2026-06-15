import { NextResponse } from "next/server";

import { listActiveLinkedDevicesForUser } from "@/lib/credential-pairing/linked-devices";
import { getOrCreateSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json(
        { error: "Reconnect to manage linked devices." },
        { status: 403 },
      );
    }

    const devices = await listActiveLinkedDevicesForUser(
      session.hqUserId,
      session.id,
    );

    return NextResponse.json({ devices });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load linked devices.",
      },
      { status: 500 },
    );
  }
}
