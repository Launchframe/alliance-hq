import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDiscordProviderAccountIdForHqUser } from "@/lib/auth/discord-hq-link.server";
import { parseConnectionInput } from "@/lib/connectionString";
import { requireApiSession } from "@/lib/session";
import {
  claimDiscordAuthNonce,
  getValidDiscordAuthNonce,
  releaseDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import { setupAshedCredentialsForDiscord } from "@/lib/vr/discord-ashed-credential-setup.server";

/** POST /api/discord/authorize — `alliance_credentials` only (`/link-ashed`). HQ login uses OAuth on `/discord/authorize/complete`. */
export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

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

  if (nonceRow.purpose === "member_link") {
    return NextResponse.json(
      {
        error:
          "This link is for commander linking. Open the /discord/link-commander page from /link-commander in Discord.",
      },
      { status: 422 },
    );
  }

  // Bind redeeming HQ session to the Discord user who minted the nonce.
  // Without this, a phished Ashed owner connection key on an attacker's
  // /link-ashed URL would store credentials under the attacker's Discord id
  // (credential_registrant → /link-alliance).
  const authSession = await auth();
  const hqUserId = authSession?.user?.id?.trim();
  if (!hqUserId) {
    return NextResponse.json(
      {
        error:
          "Sign in to Alliance HQ with Discord before connecting Ashed credentials.",
      },
      { status: 401 },
    );
  }

  const discordAccountId = await getDiscordProviderAccountIdForHqUser(hqUserId);
  if (!discordAccountId) {
    return NextResponse.json(
      {
        error:
          "Sign in with Discord (not email or Google) to finish connecting Ashed credentials.",
      },
      { status: 403 },
    );
  }

  if (discordAccountId !== nonceRow.discordUserId) {
    return NextResponse.json(
      {
        error:
          "You signed in with a different Discord account than the one that ran /link-ashed. Return to Discord, run /link-ashed again, and sign in with the same Discord account.",
      },
      { status: 403 },
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

  const claimed = await claimDiscordAuthNonce(nonce);
  if (!claimed) {
    return NextResponse.json(
      {
        error:
          "Link expired or already used. Return to Discord and run the setup command again.",
      },
      { status: 410 },
    );
  }

  const browserSession = sessionOrError;

  try {
    const result = await setupAshedCredentialsForDiscord({
      allianceTag: claimed.tag,
      connectionKey,
      discordUserId: claimed.discordUserId,
      sessionExpiresAt: browserSession.expiresAt,
    });

    if (!result.ok) {
      await releaseDiscordAuthNonce(claimed.id);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      purpose: "alliance_credentials" as const,
      tag: result.tag,
    });
  } catch (error) {
    await releaseDiscordAuthNonce(claimed.id);
    throw error;
  }
}
