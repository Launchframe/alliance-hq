import "server-only";

import { eq } from "drizzle-orm";
import { appApiUrl, authHeaders } from "@/lib/base44/fetch";
import { userAllianceAccessRole } from "@/lib/alliance/accessible";
import type { ParsedConnection } from "@/lib/connectionString";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import { getAllianceAshedCredential } from "@/lib/vr/repository";
import { ExcusedSyncError, parseExcusedSnapshot, type DesiredExcusedRecord, type ExcusedRecord } from "./excused-sync.shared";

export type ExcusedConnection = { connection: ParsedConnection; allianceId: string; appId: string };

async function request(connection: ParsedConnection, path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<unknown> {
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
    throw new ExcusedSyncError(method === "POST" ? "uncertain" : "failed");
  }
  if (response.status === 404 && method !== "POST") return null;
  if (response.status === 401 || response.status === 403) throw new ExcusedSyncError("credentials_required", response.status);
  if (!response.ok) throw new ExcusedSyncError(method === "POST" && response.status >= 500 ? "uncertain" : "failed", response.status);
  if (method === "DELETE") return null;
  try {
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error("oversize");
    return JSON.parse(text);
  } catch {
    throw new ExcusedSyncError(method === "POST" ? "uncertain" : "invalid_snapshot");
  }
}

export async function resolveExcusedConnection(hqAllianceId: string): Promise<ExcusedConnection | null> {
  const [alliance] = await getDb().select({ operatingMode: schema.alliances.operatingMode, ashedAllianceId: schema.alliances.ashedAllianceId })
    .from(schema.alliances).where(eq(schema.alliances.id, hqAllianceId)).limit(1);
  if (!alliance || alliance.operatingMode === "native" || !alliance.ashedAllianceId) return null;
  const credential = await getAllianceAshedCredential(hqAllianceId);
  if (!credential || credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() <= Date.now()) throw new ExcusedSyncError("credentials_required");
  let token: string;
  try { token = decryptSecret(credential.encryptedToken); } catch { throw new ExcusedSyncError("credentials_required"); }
  const expiresAt = resolveTokenExpiresAt(token);
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new ExcusedSyncError("credentials_required");
  const connection = { token, appId: credential.appId, originUrl: credential.originUrl };
  const [user, upstream] = await Promise.all([
    request(connection, "/entities/User/me", "GET"),
    request(connection, `/entities/Alliance/${encodeURIComponent(alliance.ashedAllianceId)}`, "GET"),
  ]);
  if (!user || typeof user !== "object" || !("email" in user) || typeof user.email !== "string" || !upstream || typeof upstream !== "object") throw new ExcusedSyncError("credentials_required");
  const row = upstream as Record<string, unknown>;
  if (row.id !== alliance.ashedAllianceId || row.collaborators != null && (!Array.isArray(row.collaborators) || !row.collaborators.every((value) => typeof value === "string"))) throw new ExcusedSyncError("credentials_required");
  const access = userAllianceAccessRole({
    id: alliance.ashedAllianceId, tag: typeof row.tag === "string" ? row.tag : "",
    owner_email: typeof row.owner_email === "string" ? row.owner_email : undefined,
    owner_id: typeof row.owner_id === "string" ? row.owner_id : undefined,
    collaborators: (row.collaborators ?? []) as string[],
  }, { email: user.email, id: "id" in user && typeof user.id === "string" ? user.id : undefined });
  if (!access) throw new ExcusedSyncError("credentials_required");
  return { connection, allianceId: alliance.ashedAllianceId, appId: credential.appId };
}

export async function fetchExcusedSnapshot(context: ExcusedConnection, deadline = Date.now() + 60_000): Promise<ExcusedRecord[]> {
  const records: ExcusedRecord[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    if (Date.now() >= deadline) throw new ExcusedSyncError("failed");
    const params = new URLSearchParams({ q: JSON.stringify({ alliance_id: context.allianceId }), sort: "id", limit: "200", skip: String(records.length) });
    const batch = parseExcusedSnapshot(await request(context.connection, `/entities/ExcusedRecord?${params}`, "GET"), context.allianceId);
    if (batch.length === 0) return records;
    for (const record of batch) {
      if (seen.has(record.id)) throw new ExcusedSyncError("invalid_snapshot");
      seen.add(record.id);
      records.push(record);
    }
  }
  throw new ExcusedSyncError("invalid_snapshot");
}

export async function fetchExcusedRecord(context: ExcusedConnection, id: string, memberId: string): Promise<ExcusedRecord | null> {
  const body = await request(context.connection, `/entities/ExcusedRecord/${encodeURIComponent(id)}`, "GET");
  if (body === null) return null;
  const record = parseExcusedSnapshot([body], context.allianceId)[0];
  if (record.id !== id || record.memberId !== memberId) throw new ExcusedSyncError("conflict");
  return record;
}

export async function validateExcusedMember(context: ExcusedConnection, memberId: string) {
  const member = await request(context.connection, `/entities/Member/${encodeURIComponent(memberId)}`, "GET");
  if (!member || typeof member !== "object" || !("id" in member) || member.id !== memberId || !("alliance_id" in member) || member.alliance_id !== context.allianceId) throw new ExcusedSyncError("conflict");
}

export async function createExcusedRecord(context: ExcusedConnection, desired: DesiredExcusedRecord): Promise<string> {
  if (desired.allianceId !== context.allianceId) throw new ExcusedSyncError("conflict");
  const body = await request(context.connection, "/entities/ExcusedRecord", "POST", {
    alliance_id: desired.allianceId, member_id: desired.memberId, record_type: desired.recordType,
    start_date: desired.startDate, end_date: desired.endDate, reason: desired.reason ?? "",
  });
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id || body.id.length > 200) throw new ExcusedSyncError("uncertain");
  return body.id;
}

export async function deleteExcusedRecord(context: ExcusedConnection, id: string) {
  await request(context.connection, `/entities/ExcusedRecord/${encodeURIComponent(id)}`, "DELETE");
}
