import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createAllianceSetupRequest } from "@/lib/alliance/alliance-setup-request.server";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

/** POST /api/discord/setup/alliance-setup-request — request HQ alliance creation. */
export async function POST(request: Request) {
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const hqLink = await getDiscordHqLinkByHqUserId(hqUserId);
  if (!hqLink) {
    return NextResponse.json(
      { error: "Link your Discord account first.", code: "discord_link_required" },
      { status: 422 },
    );
  }

  let body: {
    tag?: string;
    allianceName?: string;
    gameServerNumber?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await createAllianceSetupRequest({
    tag: body.tag ?? "",
    allianceName: body.allianceName ?? "",
    gameServerNumber: body.gameServerNumber ?? 0,
    requesterHqUserId: hqUserId,
    requesterEmail: authSession?.user?.email ?? null,
    discordUserId: hqLink.discordUserId,
  });

  if (!result.ok) {
    const status =
      result.code === "tag_not_eligible"
        ? 403
        : result.code === "provision_request_open"
          ? 409
          : 400;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }

  if (result.allianceReady) {
    return NextResponse.json({
      ok: true,
      created: result.created,
      allianceReady: true,
      allianceId: result.allianceId,
    });
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    allianceReady: false,
    setupRequest: {
      id: result.setupRequest.id,
      status: result.setupRequest.status,
      tag: result.setupRequest.tag,
      allianceName: result.setupRequest.allianceName,
      gameServerNumber: result.setupRequest.gameServerNumber,
    },
  });
}
