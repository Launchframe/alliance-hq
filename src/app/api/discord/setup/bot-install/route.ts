import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildDiscordBotInstallUrlWithState } from "@/lib/discord/bot-install-url.server";
import { resolveAllianceByTag } from "@/lib/vr/resolve-alliance-tag";
import { createDiscordBotInstallSession } from "@/lib/vr/bot-install-session.server";
import { isTagEligible } from "@/lib/vr/bot-setup";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

/** POST /api/discord/setup/bot-install — create install OAuth URL with guild registration state. */
export async function POST(request: Request) {
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    tag?: string;
    allianceId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const hqLink = await getDiscordHqLinkByHqUserId(hqUserId);
  if (!hqLink) {
    return NextResponse.json(
      { error: "Link your Discord account before adding the bot." },
      { status: 422 },
    );
  }

  const tag = body.tag?.trim();
  if (!tag) {
    return NextResponse.json({ error: "Alliance tag is required." }, { status: 400 });
  }

  if (!isTagEligible(tag)) {
    return NextResponse.json(
      {
        error: `Alliance tag "${tag}" is not eligible for bot setup on this deployment.`,
      },
      { status: 403 },
    );
  }

  let allianceId = body.allianceId?.trim() || null;

  if (!allianceId) {
    const resolved = await resolveAllianceByTag(tag, {
      discordUserId: hqLink.discordUserId,
    });
    if (resolved.ok) {
      allianceId = resolved.alliance.id;
    }
  }

  if (!allianceId) {
    return NextResponse.json(
      {
        error:
          "Connect Ashed first so your alliance exists on HQ, or use a tag that is already registered.",
      },
      { status: 422 },
    );
  }

  const nonce = await createDiscordBotInstallSession({
    hqUserId,
    discordUserId: hqLink.discordUserId,
    allianceTag: tag,
    allianceId,
  });

  const installUrl = buildDiscordBotInstallUrlWithState(nonce);
  if (!installUrl) {
    return NextResponse.json(
      { error: "Discord bot install is not configured on this deployment." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    installUrl,
    installSessionNonce: nonce,
  });
}
