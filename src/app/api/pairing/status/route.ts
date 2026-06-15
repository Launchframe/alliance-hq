import { NextResponse } from "next/server";

import { getPairingStatus } from "@/lib/credential-pairing";
import { getOrCreateSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getOrCreateSession();
    const code = new URL(request.url).searchParams.get("code")?.trim();

    if (!code) {
      return NextResponse.json({ error: "code is required." }, { status: 400 });
    }

    const result = await getPairingStatus(code, session.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load pairing status." },
      { status: 500 },
    );
  }
}
