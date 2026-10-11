import "server-only";

import { eq } from "drizzle-orm";

import {
  canInstallAshedBotCredentials,
  filterAccessibleAlliances,
} from "@/lib/alliance/accessible";
import {
  requireActiveShareCapability,
  resolveAshedConnectionForAlliance,
} from "@/lib/ashed/credential-share.server";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import type { ParsedConnection } from "@/lib/connectionString";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  getAshedConnection,
  getAshedCredentialRecord,
  loadSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { upsertAllianceAshedCredential } from "@/lib/vr/repository";

export async function upsertAllianceAshedCredentialsFromSession(input: {
  sessionId: string;
  allianceId: string;
  allowAshedMaintainer?: boolean;
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

  // Sticky #749 registrant must never be a credential-share *delegate*.
  // Delegates install with a shared owner JWT (Ashed role=owner), so stamping
  // the delegate lets them later overwrite the bot JWT via isSameRegistrant
  // using their own collaborator connection.
  let connection: ParsedConnection | null = null;
  let registeredByHqUserId = hqUserId;

  if (ownsCredential) {
    const record = await getAshedCredentialRecord(input.sessionId);
    if (record?.encryptedToken) {
      connection = {
        appId: record.appId,
        originUrl: record.originUrl,
        token: decryptSecret(record.encryptedToken),
      };
    }
  } else {
    const resolved = await resolveAshedConnectionForAlliance(
      input.sessionId,
      input.allianceId,
    );
    if (resolved?.isDelegated) {
      const delegated = await requireActiveShareCapability({
        sessionId: input.sessionId,
        allianceId: input.allianceId,
        capability: "alliance_credentials:manage",
        delegatedAction: "alliance_credentials.upsert",
      });
      connection = delegated.connection;
      registeredByHqUserId = delegated.ownerHqUserId;
    } else {
      connection = await getAshedConnection(input.sessionId);
    }
  }

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

  // Same owner gate as Discord /link-ashed authorize: collaborators/maintainers
  // must not install or overwrite alliance bot JWTs. Credential-share delegates
  // still succeed when the shared connection is an owner key (Ashed role=owner)
  // and they hold alliance_credentials:manage.
  const ashedAlliances = await base44ListAlliances(connection);
  const accessible = filterAccessibleAlliances(ashedAlliances, currentUser);
  const tagLower = alliance.tag.trim().toLowerCase();
  const ashedAlliance = accessible.find(
    (row) => row.tag.trim().toLowerCase() === tagLower,
  );
  if (!ashedAlliance) {
    return {
      ok: false,
      error: `Your Ashed account does not have access to alliance tag "${alliance.tag}".`,
      status: 403,
    };
  }
  if (!input.allowAshedMaintainer && !canInstallAshedBotCredentials(ashedAlliance.accessRole)) {
    return {
      ok: false,
      error: `Only the Ashed alliance owner can connect bot credentials for tag "${ashedAlliance.tag}". Ask the owner to install credentials, or use an owner connection key.`,
      status: 403,
    };
  }

  const { hqAllianceId } = await syncAshedAllianceForBot({
    connection,
    allianceTag: alliance.tag,
    currentUser,
  });

  // Defense-in-depth: never write bot credentials to a different HQ alliance
  // than the session settings context requested.
  if (hqAllianceId !== input.allianceId) {
    return {
      ok: false,
      error: "Ashed sync resolved a different alliance than the current session.",
      status: 409,
    };
  }

  const tokenExpiresAt = resolveTokenExpiresAt(connection.token);
  await upsertAllianceAshedCredential({
    allianceId: input.allianceId,
    appId: connection.appId,
    originUrl: connection.originUrl,
    encryptedToken: encryptSecret(connection.token),
    tokenExpiresAt,
    // Omit Discord registrant so web refresh cannot clear /link-alliance binding.
    // For delegated installs this is the share *owner*, never the delegate.
    registeredByHqUserId,
  });

  return { ok: true };
}
