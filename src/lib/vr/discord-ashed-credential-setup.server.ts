import "server-only";

import { filterAccessibleAlliances } from "@/lib/alliance/accessible";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import { parseConnectionInput, type ParsedConnection } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { capTokenExpiresAtAtSession } from "@/lib/member-link/privileged-link.shared";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { isTokenExpired } from "@/lib/jwt/decode";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { upsertAllianceAshedCredential } from "@/lib/vr/repository";

export type SetupAshedCredentialsInput = {
  allianceTag: string;
  connectionKey: string;
  discordUserId: string;
  sessionExpiresAt: Date | null;
};

export type SetupAshedCredentialsResult =
  | { ok: true; allianceId: string; tag: string }
  | { ok: false; error: string; status: number };

export async function setupAshedCredentialsForDiscord(
  input: SetupAshedCredentialsInput,
): Promise<SetupAshedCredentialsResult> {
  const tag = input.allianceTag.trim();
  if (!tag) {
    return { ok: false, error: "Alliance tag is required.", status: 400 };
  }

  const discordUserId = input.discordUserId.trim();
  if (!discordUserId) {
    return {
      ok: false,
      error: "Link your Discord account before connecting Ashed.",
      status: 422,
    };
  }

  const parsed = parseConnectionInput(input.connectionKey.trim());
  if (!parsed.ok) {
    return {
      ok: false,
      error: `Invalid connection key: ${parsed.error}`,
      status: 422,
    };
  }

  let me;
  try {
    me = await verifyBase44Connection(parsed.connection);
  } catch (error) {
    return {
      ok: false,
      error: `Connection key verification failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      status: 422,
    };
  }

  if (!me.email?.trim()) {
    return {
      ok: false,
      error: "Connection key is missing an email address.",
      status: 422,
    };
  }

  const currentUser = { email: me.email, id: me.id, full_name: me.full_name };
  const alliances = await base44ListAlliances(parsed.connection);
  const accessible = filterAccessibleAlliances(alliances, currentUser);

  if (accessible.length === 0) {
    return {
      ok: false,
      error: "Your Ashed account does not have access to any alliance.",
      status: 403,
    };
  }

  const tagLower = tag.toLowerCase();
  const ashedAlliance = accessible.find(
    (row) => row.tag.trim().toLowerCase() === tagLower,
  );

  if (!ashedAlliance) {
    return {
      ok: false,
      error: `Your Ashed account does not have access to alliance tag "${tag}".`,
      status: 403,
    };
  }

  const { hqAllianceId, hqUserId } = await syncAshedAllianceForBot({
    connection: parsed.connection,
    allianceTag: tag,
    currentUser,
  });

  let tokenExpiresAt = resolveTokenExpiresAt(parsed.connection.token);
  tokenExpiresAt = capTokenExpiresAtAtSession(
    tokenExpiresAt,
    input.sessionExpiresAt,
  );
  if (tokenExpiresAt && isTokenExpired(tokenExpiresAt)) {
    return {
      ok: false,
      error: "Connection key is already expired. Copy a fresh one from Ashed.",
      status: 422,
    };
  }

  await upsertAllianceAshedCredential({
    allianceId: hqAllianceId,
    appId: parsed.connection.appId,
    originUrl: parsed.connection.originUrl,
    encryptedToken: encryptSecret(parsed.connection.token),
    tokenExpiresAt,
    registeredByDiscordUserId: discordUserId,
    registeredByHqUserId: hqUserId ?? null,
  });

  return { ok: true, allianceId: hqAllianceId, tag: ashedAlliance.tag };
}

export function formatConnectionKeyFromParts(input: {
  input: string;
  appId: string;
  originUrl: string;
}): string {
  return input.input.trim();
}

export function parseConnectionKeyInput(body: {
  connectionKey?: string;
  input?: string;
}): string {
  return (body.connectionKey ?? body.input ?? "").trim();
}

export type { ParsedConnection };
