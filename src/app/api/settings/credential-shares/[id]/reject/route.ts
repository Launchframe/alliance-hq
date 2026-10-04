import { NextResponse } from "next/server";

import {
  CredentialShareError,
  rejectCredentialShare,
} from "@/lib/ashed/credential-share.server";
import { readSessionId } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await rejectCredentialShare({ shareId: id, sessionId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CredentialShareError) {
      const status = error.code === "FORBIDDEN" ? 403 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
