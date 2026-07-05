import { NextResponse } from "next/server";

import { filterAccessibleAlliances } from "@/lib/alliance/accessible";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import { parseConnectionInput } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { capTokenExpiresAtAtSession } from "@/lib/member-link/privileged-link.shared";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { isTokenExpired } from "@/lib/jwt/decode";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { getOrCreateSession } from "@/lib/session";
import { upsertAllianceAshedCredential } from "@/lib/vr/repository";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";

/** POST /api/discord/authorize — `alliance_credentials` only (`/link-ashed`). HQ login uses OAuth on `/discord/authorize/complete`. */
export async function POST(request: Request) {
  const session = await getOrCreateSession();

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

  let me;
  try {
    me = await verifyBase44Connection(parsed.connection);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Connection key verification failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
      { status: 422 },
    );
  }

  if (!me.email?.trim()) {
    return NextResponse.json(
      { error: "Connection key is missing an email address." },
      { status: 422 },
    );
  }

  const currentUser = { email: me.email, id: me.id, full_name: me.full_name };
  const alliances = await base44ListAlliances(parsed.connection);
  const accessible = filterAccessibleAlliances(alliances, currentUser);

  if (accessible.length === 0) {
    return NextResponse.json(
      { error: "Your Ashed account does not have access to any alliance." },
      { status: 403 },
    );
  }

  const tagLower = nonceRow.tag;
  const ashedAlliance = accessible.find(
    (row) => row.tag.trim().toLowerCase() === tagLower,
  );

  if (!ashedAlliance) {
    return NextResponse.json(
      {
        error: `Your Ashed account does not have access to alliance tag "${nonceRow.tag}".`,
      },
      { status: 403 },
    );
  }

  // Any Ashed account with access to this alliance (owner or collaborator) may
  // supply credentials for roster sync. The owner may not hold an Ashed seat —
  // an R5 can be a native HQ user — so we do not require the "owner" role here.
  // `filterAccessibleAlliances` already restricts to owner/collaborator access,
  // and these credentials are used only for read/sync of the alliance roster.

  const { hqAllianceId, hqUserId } = await syncAshedAllianceForBot({
    connection: parsed.connection,
    allianceTag: nonceRow.tag,
    currentUser,
  });

  let tokenExpiresAt = resolveTokenExpiresAt(parsed.connection.token);
  tokenExpiresAt = capTokenExpiresAtAtSession(
    tokenExpiresAt,
    session.expiresAt,
  );
  if (tokenExpiresAt && isTokenExpired(tokenExpiresAt)) {
    return NextResponse.json(
      { error: "Connection key is already expired. Copy a fresh one from Ashed." },
      { status: 422 },
    );
  }

  await upsertAllianceAshedCredential({
    allianceId: hqAllianceId,
    appId: parsed.connection.appId,
    originUrl: parsed.connection.originUrl,
    encryptedToken: encryptSecret(parsed.connection.token),
    tokenExpiresAt,
    registeredByDiscordUserId: nonceRow.discordUserId,
    registeredByHqUserId: hqUserId ?? null,
  });

  await consumeDiscordAuthNonce(nonceRow.id);

  return NextResponse.json({
    ok: true,
    purpose: "alliance_credentials" as const,
    tag: ashedAlliance.tag,
  });
}
