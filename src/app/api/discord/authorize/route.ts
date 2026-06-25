import { NextResponse } from "next/server";

import {
  filterAccessibleAlliances,
  userAllianceAccessRole,
} from "@/lib/alliance/accessible";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import { parseConnectionInput } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { capTokenExpiresAt } from "@/lib/member-link/privileged-link.shared";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { isTokenExpired } from "@/lib/jwt/decode";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { getOrCreateSession } from "@/lib/session";
import {
  getGuildAllianceId,
  getDiscordUserLocale,
  upsertAllianceAshedCredential,
} from "@/lib/vr/repository";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import { handleDiscordLinkCommanderSlash } from "@/lib/vr/service";

/** POST /api/discord/authorize
 *  `user_link`: in-game name + UID (member link — no Ashed).
 *  `alliance_credentials`: Ashed connection key for `/link-to-ashed-seat`.
 */
export async function POST(request: Request) {
  await getOrCreateSession();

  let body: {
    nonce?: string;
    connectionKey?: string;
    reportedName?: string;
    gameUid?: string;
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
    const reportedName = body.reportedName?.trim();
    const gameUid = body.gameUid?.trim();
    if (!reportedName || !gameUid) {
      return NextResponse.json(
        { error: "In-game name and player UID are required." },
        { status: 400 },
      );
    }

    const guildId = nonceRow.guildId?.trim();
    if (!guildId) {
      return NextResponse.json(
        {
          error:
            "This link must be opened from your alliance Discord server. Run `/link` there and try again.",
        },
        { status: 422 },
      );
    }

    const allianceId = await getGuildAllianceId(guildId);
    if (!allianceId) {
      return NextResponse.json(
        {
          error:
            "This Discord server is not linked to an alliance yet. Ask the owner to run `/link-alliance` first.",
        },
        { status: 422 },
      );
    }

    const storedLocale = await getDiscordUserLocale(nonceRow.discordUserId);
    const locale = storedLocale ?? "en-US";
    const result = await handleDiscordLinkCommanderSlash({
      allianceId,
      guildId,
      discordUserId: nonceRow.discordUserId,
      reportedName,
      gameUid,
      locale,
    });

    if (result.pending) {
      return NextResponse.json(
        {
          error: `${result.reply} Return to Discord to continue — some steps need buttons there.`,
        },
        { status: 422 },
      );
    }

    if (!result.linked) {
      return NextResponse.json({ error: result.reply }, { status: 422 });
    }

    await consumeDiscordAuthNonce(nonceRow.id);

    return NextResponse.json({
      ok: true,
      purpose: "user_link" as const,
      memberDisplayName: result.linkTarget?.memberDisplayName ?? reportedName,
    });
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

  const ashedRow = alliances.find((row) => row.id === ashedAlliance.id);
  const accessRole = ashedRow ? userAllianceAccessRole(ashedRow, currentUser) : null;
  if (accessRole !== "owner") {
    return NextResponse.json(
      {
        error: `Your Ashed account must be the alliance owner for tag "${nonceRow.tag}".`,
      },
      { status: 403 },
    );
  }

  const { hqAllianceId, hqUserId } = await syncAshedAllianceForBot({
    connection: parsed.connection,
    allianceTag: nonceRow.tag,
    currentUser,
  });

  let tokenExpiresAt = resolveTokenExpiresAt(parsed.connection.token);
  tokenExpiresAt = capTokenExpiresAt(tokenExpiresAt);
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
