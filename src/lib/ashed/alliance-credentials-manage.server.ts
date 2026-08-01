import "server-only";

import { eq } from "drizzle-orm";

import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { verifyBase44Connection } from "@/lib/base44/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  getAshedCredentialRecord,
  loadSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { upsertAllianceAshedCredential } from "@/lib/vr/repository";

export async function upsertAllianceAshedCredentialsFromSession(input: {
  sessionId: string;
  allianceId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const session = await loadSession(input.sessionId);
  if (!session?.hqUserId) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    input.sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const ownsCredential = await sessionHoldsAshedIdentityForHqUser(
    input.sessionId,
    hqUserId,
  );

  const connection = ownsCredential
    ? await (async () => {
        const record = await getAshedCredentialRecord(input.sessionId);
        if (!record?.encryptedToken) return null;
        return {
          appId: record.appId,
          originUrl: record.originUrl,
          token: decryptSecret(record.encryptedToken),
        };
      })()
    : await loadAshedConnectionForAllianceCapability({
        sessionId: input.sessionId,
        allianceId: input.allianceId,
        capability: "alliance_credentials:manage",
        delegatedAction: "alliance_credentials.upsert",
      });

  if (!connection) {
    return {
      ok: false,
      error: "Ashed credentials are required to manage alliance bot credentials.",
      status: 400,
    };
  }

  let me;
  try {
    me = await verifyBase44Connection(connection);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Ashed connection verification failed.",
      status: 422,
    };
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance?.tag) {
    return { ok: false, error: "Alliance not found.", status: 404 };
  }

  const currentUser = {
    email: me.email ?? "",
    id: me.id,
    full_name: me.full_name ?? undefined,
  };

  const { hqAllianceId } = await syncAshedAllianceForBot({
    connection,
    allianceTag: alliance.tag,
    currentUser,
  });

  const tokenExpiresAt = resolveTokenExpiresAt(connection.token);
  await upsertAllianceAshedCredential({
    allianceId: hqAllianceId,
    appId: connection.appId,
    originUrl: connection.originUrl,
    encryptedToken: encryptSecret(connection.token),
    tokenExpiresAt,
    registeredByHqUserId: hqUserId,
  });

  return { ok: true };
}
