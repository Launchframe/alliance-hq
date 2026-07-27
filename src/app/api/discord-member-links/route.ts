import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  deleteDiscordMemberLink,
  listDiscordMemberLinks,
  upsertDiscordMemberLink,
} from "@/lib/vr/repository";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type LinkBody = {
  discordUserId?: string;
  discordUsername?: string;
  ashedMemberId?: string;
  memberDisplayName?: string;
  gameUid?: string;
};

/**
 * Maintainer-only break-glass for Discord member links.
 *
 * Must not be officer-gated: `members:write` officers could otherwise bind an
 * arbitrary Discord user to `ownerMemberExternalId` / R4+ without name+UID
 * proof and inherit Discord owner/officer bot gates. UIDs in list responses
 * are also maintainer-scoped (player-uid-privacy).
 */
async function requireMaintainerAlliance() {
  const session = await getOrCreateSession();
  const denied = await requirePlatformMaintainer(session.id);
  if (denied) return { denied };

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return {
      denied: NextResponse.json({ error: "No alliance selected." }, { status: 400 }),
    };
  }
  return { allianceId };
}

export async function GET() {
  const gate = await requireMaintainerAlliance();
  if (gate.denied) return gate.denied;

  const links = await listDiscordMemberLinks(gate.allianceId);
  return NextResponse.json({ links });
}

export async function POST(request: Request) {
  const gate = await requireMaintainerAlliance();
  if (gate.denied) return gate.denied;

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
    allianceId: gate.allianceId,
    discordUserId,
    discordUsername: body.discordUsername?.trim() || null,
    ashedMemberId,
    memberDisplayName: body.memberDisplayName?.trim() || null,
    gameUid,
  });

  return NextResponse.json({ link });
}

export async function DELETE(request: Request) {
  const gate = await requireMaintainerAlliance();
  if (gate.denied) return gate.denied;

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

  if (!row || row.allianceId !== gate.allianceId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await deleteDiscordMemberLink(id);
  return NextResponse.json({ ok: true });
}
