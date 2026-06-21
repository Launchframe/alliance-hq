import { NextResponse } from "next/server";

import { signOut } from "@/lib/auth";
import {
  clearAshedConnection,
  clearSessionUserBinding,
  readSessionId,
} from "@/lib/session";

export async function POST() {
  const sessionId = await readSessionId();

  await signOut({ redirect: false });

  if (sessionId) {
    await clearAshedConnection(sessionId);
    await clearSessionUserBinding(sessionId);
  }

  return NextResponse.json({ ok: true });
}
