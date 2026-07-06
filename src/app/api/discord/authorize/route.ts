import { NextResponse } from "next/server";

import { parseConnectionInput } from "@/lib/connectionString";
import { getOrCreateSession, loadSession } from "@/lib/session";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import { setupAshedCredentialsForDiscord } from "@/lib/vr/discord-ashed-credential-setup.server";

/** POST /api/discord/authorize — `alliance_credentials` only (`/link-ashed`). HQ login uses OAuth on `/discord/authorize/complete`. */
export async function POST(request: Request) {
  await getOrCreateSession();

  let body: {
    nonce?: string;
    connectionKey?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const nonce = body.nonce?.trim();
  if (!nonce) {
    return NextResponse.json({ error: "nonce is required." }, { status: 400 });
  }

  const nonceRow = await getValidDiscordAuthNonce(nonce);
  if (!nonceRow) {
    return NextResponse.json(
      {
        error:
          "Link expired or already used. Return to Discord and run the setup command again.",
      },
      { status: 410 },
    );
  }

  if (nonceRow.purpose === "user_link") {
    return NextResponse.json(
      {
        error:
          "This link is for Alliance HQ sign-in. Use Continue with Discord on the page, not this form.",
      },
      { status: 422 },
    );
  }

  const connectionKey = body.connectionKey?.trim();
  if (!connectionKey) {
    return NextResponse.json(
      { error: "connectionKey is required for alliance credential setup." },
      { status: 400 },
    );
  }

  const parsed = parseConnectionInput(connectionKey);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `Invalid connection key: ${parsed.error}` },
      { status: 422 },
    );
  }

  const browserSession = await loadSession((await getOrCreateSession()).id);

  const result = await setupAshedCredentialsForDiscord({
    allianceTag: nonceRow.tag,
    connectionKey,
    discordUserId: nonceRow.discordUserId,
    sessionExpiresAt: browserSession?.expiresAt ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await consumeDiscordAuthNonce(nonceRow.id);

  return NextResponse.json({
    ok: true,
    purpose: "alliance_credentials" as const,
    tag: result.tag,
  });
}
