import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  listCredentialShareActivity,
  toPublicCredentialShareAuditEntry,
  userCanViewFullCredentialShareHistory,
} from "@/lib/ashed/credential-share-audit.server";
import { getDb, schema } from "@/lib/db";
import { getRbacContext } from "@/lib/rbac/context";
import {
  loadSession,
  readSessionId,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

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

  if (shareId) {
    const [share] = await db
      .select({
        ownerHqUserId: schema.ashedCredentialShares.ownerHqUserId,
        delegateHqUserId: schema.ashedCredentialShares.delegateHqUserId,
        invitedHqUserId: schema.ashedCredentialShares.invitedHqUserId,
      })
      .from(schema.ashedCredentialShares)
      .where(eq(schema.ashedCredentialShares.id, shareId))
      .limit(1);

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const canAccessShare =
      (rbac?.isPlatformMaintainer ?? false) ||
      share.ownerHqUserId === hqUserId ||
      share.delegateHqUserId === hqUserId ||
      share.invitedHqUserId === hqUserId;

    if (!canAccessShare) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const result = await listCredentialShareActivity({
    hqUserId,
    shareId,
    allianceId,
    cursor,
    limit: 50,
  });

  return NextResponse.json({
    items: result.items.map(toPublicCredentialShareAuditEntry),
    nextCursor: result.nextCursor,
  });
}
