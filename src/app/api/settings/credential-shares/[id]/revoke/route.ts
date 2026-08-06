import { NextResponse } from "next/server";

import {
  CredentialShareError,
  revokeCredentialShare,
} from "@/lib/ashed/credential-share.server";
import { getRbacContext } from "@/lib/rbac/context";
import { loadSession, readSessionId, resolveEffectiveHqUserIdForSession } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const rbac = await getRbacContext(sessionId);

  try {
    await revokeCredentialShare({
      shareId: id,
      sessionId,
      hqUserId,
      isPlatformMaintainer: rbac?.isPlatformMaintainer,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CredentialShareError) {
      const status = error.code === "FORBIDDEN" ? 403 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
