import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getOrCreateSession, loadSession } from "@/lib/session";
import { updateDiscordBotInstallSessionAllianceByNonce } from "@/lib/vr/bot-install-session.server";
import { isTagEligible } from "@/lib/vr/bot-setup";
import {
  parseConnectionKeyInput,
  setupAshedCredentialsForDiscord,
} from "@/lib/vr/discord-ashed-credential-setup.server";
import { getDiscordHqLinkByHqUserId } from "@/lib/vr/repository";

/** POST /api/discord/setup/ashed — Connect Ashed from the install wizard (session + linked Discord). */
export async function POST(request: Request) {
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    tag?: string;
    connectionKey?: string;
    input?: string;
    installSessionNonce?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
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

  const hqLink = await getDiscordHqLinkByHqUserId(hqUserId);
  if (!hqLink) {
    return NextResponse.json(
      { error: "Link your Discord account before connecting Ashed." },
      { status: 422 },
    );
  }

  const browserSession = await loadSession((await getOrCreateSession()).id);

  const result = await setupAshedCredentialsForDiscord({
    allianceTag: tag,
    connectionKey: parseConnectionKeyInput(body),
    discordUserId: hqLink.discordUserId,
    sessionExpiresAt: browserSession?.expiresAt ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const installSessionNonce = body.installSessionNonce?.trim();
  if (installSessionNonce) {
    await updateDiscordBotInstallSessionAllianceByNonce({
      nonce: installSessionNonce,
      allianceId: result.allianceId,
    });
  }

  return NextResponse.json({
    ok: true,
    tag: result.tag,
    allianceId: result.allianceId,
  });
}
