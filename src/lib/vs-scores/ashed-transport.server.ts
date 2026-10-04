import "server-only";

import { eq } from "drizzle-orm";
import { userAllianceAccessRole } from "@/lib/alliance/accessible";
import { appApiUrl, authHeaders } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { getAllianceAshedCredential } from "@/lib/vr/repository";

export class VsSyncError extends Error {
  constructor(
    public readonly code:
      | "invalid_snapshot"
      | "credentials_required"
      | "failed"
      | "uncertain"
      | "conflict"
      | "busy",
    public readonly httpStatus?: number,
  ) {
    super(code);
  }
}

export type VsAshedConnection = {
  connection: ParsedConnection;
  allianceId: string;
  appId: string;
};

async function ashedRequest(
  connection: ParsedConnection,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(appApiUrl(connection, path), {
      method,
      headers: { ...authHeaders(connection), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new VsSyncError(method === "POST" ? "uncertain" : "failed");
  }
  if (response.status === 404 && method !== "POST") return null;
  if (response.status === 401 || response.status === 403) {
    throw new VsSyncError("credentials_required", response.status);
  }
  if (!response.ok) {
    throw new VsSyncError(
      method === "POST" && response.status >= 500 ? "uncertain" : "failed",
      response.status,
    );
  }
  if (method === "DELETE") return null;
  try {
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error("oversize");
    return JSON.parse(text);
  } catch {
    throw new VsSyncError(method === "POST" ? "uncertain" : "invalid_snapshot");
  }
}

export async function resolveVsAshedConnection(
  hqAllianceId: string,
): Promise<VsAshedConnection | null> {
  const [alliance] = await getDb()
    .select({
      operatingMode: schema.alliances.operatingMode,
      ashedAllianceId: schema.alliances.ashedAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, hqAllianceId))
    .limit(1);
  if (!alliance || alliance.operatingMode === "native" || !alliance.ashedAllianceId) {
    return null;
  }
  const credential = await getAllianceAshedCredential(hqAllianceId);
  if (!credential || (credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() <= Date.now())) {
    throw new VsSyncError("credentials_required");
  }
  let token: string;
  try {
    token = decryptSecret(credential.encryptedToken);
  } catch {
    throw new VsSyncError("credentials_required");
  }
  const expiresAt = resolveTokenExpiresAt(token);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new VsSyncError("credentials_required");
  }
  const connection = {
    token,
    appId: credential.appId,
    originUrl: credential.originUrl,
  };
  const [user, upstream] = await Promise.all([
    ashedRequest(connection, "/entities/User/me", "GET"),
    ashedRequest(
      connection,
      `/entities/Alliance/${encodeURIComponent(alliance.ashedAllianceId)}`,
      "GET",
    ),
  ]);
  if (
    !user ||
    typeof user !== "object" ||
    !("email" in user) ||
    typeof user.email !== "string" ||
    !upstream ||
    typeof upstream !== "object"
  ) {
    throw new VsSyncError("credentials_required");
  }
  const row = upstream as Record<string, unknown>;
  if (
    row.id !== alliance.ashedAllianceId ||
    (row.collaborators != null &&
      (!Array.isArray(row.collaborators) ||
        !row.collaborators.every((value) => typeof value === "string")))
  ) {
    throw new VsSyncError("credentials_required");
  }
  const access = userAllianceAccessRole(
    {
      id: alliance.ashedAllianceId,
      tag: typeof row.tag === "string" ? row.tag : "",
      owner_email: typeof row.owner_email === "string" ? row.owner_email : undefined,
      owner_id: typeof row.owner_id === "string" ? row.owner_id : undefined,
      collaborators: (row.collaborators ?? []) as string[],
    },
    {
      email: user.email,
      id: "id" in user && typeof user.id === "string" ? user.id : undefined,
    },
  );
  if (!access) throw new VsSyncError("credentials_required");
  return {
    connection,
    allianceId: alliance.ashedAllianceId,
    appId: credential.appId,
  };
}

export async function validateVsAshedMember(
  context: VsAshedConnection,
  memberId: string,
) {
  const member = await ashedRequest(
    context.connection,
    `/entities/Member/${encodeURIComponent(memberId)}`,
    "GET",
  );
  if (
    !member ||
    typeof member !== "object" ||
    !("id" in member) ||
    member.id !== memberId ||
    !("alliance_id" in member) ||
    member.alliance_id !== context.allianceId
  ) {
    throw new VsSyncError("conflict");
  }
}
