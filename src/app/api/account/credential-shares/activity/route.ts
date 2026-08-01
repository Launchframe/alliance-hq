import { NextResponse } from "next/server";

import { listCredentialShareActivity } from "@/lib/ashed/credential-share-audit.server";
import {
  loadSession,
  readSessionId,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { getRbacContext } from "@/lib/rbac/context";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { userCanViewFullCredentialShareHistory } from "@/lib/ashed/credential-share-audit.server";

export async function GET(request: Request) {
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

  const rbac = await getRbacContext(sessionId);
  const db = getDb();
  const [user] = await db
    .select({ ashedUserId: schema.hqUsers.ashedUserId })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  const canView = await userCanViewFullCredentialShareHistory({
    hqUserId,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
    hasAshedUserId: Boolean(user?.ashedUserId?.trim()),
  });

  if (!canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const shareId = url.searchParams.get("shareId") ?? undefined;
  const allianceId = url.searchParams.get("allianceId") ?? undefined;

  const result = await listCredentialShareActivity({
    hqUserId,
    shareId,
    allianceId,
    cursor,
    limit: 50,
  });

  return NextResponse.json(result);
}
