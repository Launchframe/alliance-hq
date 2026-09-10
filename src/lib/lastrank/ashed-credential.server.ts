import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import {
  canInstallAshedBotCredentials,
  filterAccessibleAlliances,
} from "@/lib/alliance/accessible";
import type { AllianceAccessRole } from "@/lib/alliance/types";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import {
  DEFAULT_APP_ID,
  parseConnectionInput,
  type ParsedConnection,
} from "@/lib/connectionString";
import { decryptSecret, encryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { isTokenExpired } from "@/lib/jwt/decode";
import { NATIVE_ROSTER_ASHED_ALLIANCE_ID } from "@/lib/native-alliance/constants";

export type LastRankAshedWriteContext = {
  connection: ParsedConnection;
  ashedAllianceId: string;
};

export function isSyntheticNativeAshedAllianceId(
  ashedAllianceId: string | null | undefined,
): boolean {
  const id = ashedAllianceId?.trim() ?? "";
  return (
    !id ||
    id === NATIVE_ROSTER_ASHED_ALLIANCE_ID ||
    id.startsWith(`${NATIVE_ROSTER_ASHED_ALLIANCE_ID}:`)
  );
}

function buildLegacyBotAshedConnection(): ParsedConnection | null {
  const token = process.env.VR_BOT_ASHED_BEARER_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    appId: process.env.BASE44_APP_ID?.trim() || DEFAULT_APP_ID,
    originUrl: process.env.BASE44_ORIGIN_URL?.trim() || "https://ashed.online",
  };
}

async function loadAllianceAshedCredentialRow(allianceId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceAshedCredentials)
    .where(eq(schema.allianceAshedCredentials.allianceId, allianceId))
    .limit(1);
  return row ?? null;
}

async function loadAllianceTag(allianceId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.tag ?? null;
}

/** CLI-safe bot JWT load — no Discord/session/next imports. */
async function resolveAllianceAshedBotConnectionForCli(
  allianceId: string,
): Promise<ParsedConnection | null> {
  const credential = await loadAllianceAshedCredentialRow(allianceId);
  if (credential) {
    try {
      return {
        token: decryptSecret(credential.encryptedToken),
        appId: credential.appId,
        originUrl: credential.originUrl,
      };
    } catch (error) {
      console.error(
        "[lastrank] failed to decrypt alliance Ashed credential",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  const tag = await loadAllianceTag(allianceId);
  if (!tag) return null;
  const guardTag = process.env.VR_BOT_ASHED_ALLIANCE_TAG?.trim();
  if (!guardTag || tag.trim().toLowerCase() !== guardTag.trim().toLowerCase()) {
    return null;
  }
  return buildLegacyBotAshedConnection();
}

/** Owner-only, matching web/Discord /link-ashed. Collaborators must not overwrite. */
export function lastRankBotCredentialInstallError(input: {
  ashedAlliance:
    | { id?: string | null; accessRole: AllianceAccessRole }
    | undefined;
  allianceTag: string;
}): string | null {
  if (!input.ashedAlliance?.id) {
    return `Your Ashed account does not have access to alliance tag "${input.allianceTag}".`;
  }
  if (!canInstallAshedBotCredentials(input.ashedAlliance.accessRole)) {
    return `Only the Ashed alliance owner can connect bot credentials for tag "${input.allianceTag}". Use an owner connection key.`;
  }
  return null;
}

/** Load bot JWT + real Ashed alliance id when dual-write is possible. */
export async function loadLastRankAshedWriteContext(
  hqAllianceId: string,
): Promise<LastRankAshedWriteContext | null> {
  const ashedAllianceId = await getAshedAllianceIdIfLinked(hqAllianceId);
  if (!ashedAllianceId || isSyntheticNativeAshedAllianceId(ashedAllianceId)) {
    return null;
  }
  const connection = await resolveAllianceAshedBotConnectionForCli(hqAllianceId);
  if (!connection) return null;
  return { connection, ashedAllianceId };
}

export async function upsertAllianceAshedCredentialFromConnectionKey(input: {
  hqAllianceId: string;
  allianceTag: string;
  connectionKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseConnectionInput(input.connectionKey.trim());
  if (!parsed.ok) {
    return { ok: false, error: `Invalid connection key: ${parsed.error}` };
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
    };
  }

  if (!me.email?.trim()) {
    return {
      ok: false,
      error: "Connection key is missing an email address.",
    };
  }

  const currentUser = {
    email: me.email,
    id: me.id,
    full_name: me.full_name ?? undefined,
  };
  const alliances = await base44ListAlliances(parsed.connection);
  const accessible = filterAccessibleAlliances(alliances, currentUser);
  const tagLower = input.allianceTag.trim().toLowerCase();
  const ashedAlliance = accessible.find(
    (row) => (row.tag ?? "").trim().toLowerCase() === tagLower,
  );
  const installError = lastRankBotCredentialInstallError({
    ashedAlliance,
    allianceTag: input.allianceTag,
  });
  if (installError) {
    return { ok: false, error: installError };
  }
  if (!ashedAlliance?.id) {
    return {
      ok: false,
      error: `Your Ashed account does not have access to alliance tag "${input.allianceTag}".`,
    };
  }

  const tokenExpiresAt = resolveTokenExpiresAt(parsed.connection.token);
  if (tokenExpiresAt && isTokenExpired(tokenExpiresAt)) {
    return {
      ok: false,
      error: "Connection key is already expired. Copy a fresh one from Ashed.",
    };
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.hqAllianceId))
    .limit(1);
  if (!alliance) {
    return { ok: false, error: "HQ alliance not found." };
  }

  const existingAshedId = alliance.ashedAllianceId?.trim() ?? "";
  if (
    existingAshedId &&
    !isSyntheticNativeAshedAllianceId(existingAshedId) &&
    existingAshedId !== ashedAlliance.id
  ) {
    return {
      ok: false,
      error:
        "HQ is already linked to a different Ashed alliance. Refusing to overwrite bot credentials.",
    };
  }
  if (!existingAshedId || isSyntheticNativeAshedAllianceId(existingAshedId)) {
    await db
      .update(schema.alliances)
      .set({
        ashedAllianceId: ashedAlliance.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.alliances.id, input.hqAllianceId));
  }

  const now = new Date();
  // Omit registrant columns on conflict so a CLI refresh cannot clear the
  // Discord / HQ binding that unlocks /link-alliance (same as web upsert).
  await db
    .insert(schema.allianceAshedCredentials)
    .values({
      id: nanoid(),
      allianceId: input.hqAllianceId,
      appId: parsed.connection.appId,
      originUrl: parsed.connection.originUrl,
      encryptedToken: encryptSecret(parsed.connection.token),
      tokenExpiresAt,
      registeredByDiscordUserId: null,
      registeredByHqUserId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.allianceAshedCredentials.allianceId,
      set: {
        appId: parsed.connection.appId,
        originUrl: parsed.connection.originUrl,
        encryptedToken: encryptSecret(parsed.connection.token),
        tokenExpiresAt,
        updatedAt: now,
      },
    });

  return { ok: true };
}
