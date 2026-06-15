import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  deleteDiscordMemberLink,
  listDiscordMemberLinks,
  upsertDiscordMemberLink,
} from "@/lib/vr/repository";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type LinkBody = {
  discordUserId?: string;
  discordUsername?: string;
  ashedMemberId?: string;
  memberDisplayName?: string;
  gameUid?: string;
};

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const links = await listDiscordMemberLinks(allianceId);
  return NextResponse.json({ links });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const body = (await request.json()) as LinkBody;
  const discordUserId = body.discordUserId?.trim();
  const ashedMemberId = body.ashedMemberId?.trim();
  const gameUid = body.gameUid?.trim();
  if (!discordUserId || !ashedMemberId || !gameUid) {
    return NextResponse.json(
      { error: "discordUserId, ashedMemberId, and gameUid are required." },
      { status: 400 },
    );
  }

  const link = await upsertDiscordMemberLink({
    allianceId,
    discordUserId,
    discordUsername: body.discordUsername?.trim() || null,
    ashedMemberId,
    memberDisplayName: body.memberDisplayName?.trim() || null,
    gameUid,
  });

  return NextResponse.json({ link });
}

export async function DELETE(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id query param is required." }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.discordMemberLinks)
    .where(eq(schema.discordMemberLinks.id, id))
    .limit(1);

  if (!row || row.allianceId !== allianceId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await deleteDiscordMemberLink(id);
  return NextResponse.json({ ok: true });
}
