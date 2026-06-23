import { NextResponse } from "next/server";

import {
  filterAccessibleAlliances,
  userAllianceAccessRole,
} from "@/lib/alliance/accessible";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import { parseConnectionInput } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { resolveCanonicalHqUserForAshedConnect } from "@/lib/rbac/resolve-canonical-hq-user";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { getOrCreateSession } from "@/lib/session";
import {
  getGuildAllianceId,
  listDiscordLinksForUser,
  upsertAllianceAshedCredential,
  upsertDiscordHqLink,
} from "@/lib/vr/repository";
import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";

/** POST /api/discord/authorize
 *  Accepts the Ashed connection key submitted via the HQ web form.
 *
 *  Body: { nonce: string; connectionKey: string }
 */
export async function POST(request: Request) {
  await getOrCreateSession();

  let body: { nonce?: string; connectionKey?: string };
  try {
    body = (await request.json()) as { nonce?: string; connectionKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const nonce = body.nonce?.trim();
  const connectionKey = body.connectionKey?.trim();

  if (!nonce || !connectionKey) {
    return NextResponse.json(
      { error: "nonce and connectionKey are required." },
      { status: 400 },
    );
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

  if (nonceRow.purpose === "user_link") {
    const { hqUserId } = await resolveCanonicalHqUserForAshedConnect({
      ashedUserId: me.id,
      ashedEmail: me.email,
      displayName: me.full_name,
    });

    await upsertDiscordHqLink({
      discordUserId: nonceRow.discordUserId,
      hqUserId,
    });

    await consumeDiscordAuthNonce(nonceRow.id);

    let promptFirstCommander = false;
    const guildId = nonceRow.guildId?.trim();
    if (guildId) {
      const allianceId = await getGuildAllianceId(guildId);
      if (allianceId) {
        const links = await listDiscordLinksForUser(
          allianceId,
          nonceRow.discordUserId,
        );
        promptFirstCommander = links.length === 0;
      }
    }

    return NextResponse.json({
      ok: true,
      purpose: "user_link" as const,
      promptFirstCommander,
    });
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

  await upsertAllianceAshedCredential({
    allianceId: hqAllianceId,
    appId: parsed.connection.appId,
    originUrl: parsed.connection.originUrl,
    encryptedToken: encryptSecret(parsed.connection.token),
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
