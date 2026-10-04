import "server-only";

import { eq } from "drizzle-orm";

import { userAllianceAccessRole } from "@/lib/alliance/accessible";
import {
  CredentialShareError,
  resolveAshedConnectionForAlliance,
  requireActiveShareCapability,
} from "@/lib/ashed/credential-share.server";
import { appApiUrl, authHeaders } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  resolveVsAshedConnection,
  VsSyncError,
} from "@/lib/vs-scores/ashed-transport.server";
import {
  parseAshedOpponentRow,
  type AshedOpponentSnapshot,
} from "@/lib/vs-performance/opponent-info.shared";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";

export type VsOpponentAshedContext = {
  connection: ParsedConnection;
  allianceId: string;
  deadline?: number;
};

const META_LIST_PAGE_SIZE = 200;
const META_LIST_MAX_PAGES = 50;
const META_MAX_BODY_BYTES = 4_000_000;
const META_REQUEST_TIMEOUT_MS = 10_000;
const META_SYNC_DEADLINE_MS = 45_000;

async function ashedMetaFetch(
  context: VsOpponentAshedContext,
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const remaining = context.deadline
    ? context.deadline - Date.now()
    : META_SYNC_DEADLINE_MS;
  if (remaining <= 0) {
    throw new VsSyncError(method === "GET" ? "failed" : "uncertain");
  }
  let response: Response;
  try {
    response = await fetch(appApiUrl(context.connection, path), {
      method,
      headers: {
        ...authHeaders(context.connection),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(
        Math.min(META_REQUEST_TIMEOUT_MS, remaining),
      ),
    });
  } catch {
    throw new VsSyncError(
      method === "GET" ? "failed" : "uncertain",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new VsSyncError("credentials_required", response.status);
  }
  if (!response.ok) {
    throw new VsSyncError(
      method !== "GET" && response.status >= 500
        ? "uncertain"
        : "failed",
      response.status,
    );
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > META_MAX_BODY_BYTES) {
          await reader.cancel();
          throw new VsSyncError(method === "GET" ? "invalid_snapshot" : "uncertain");
        }
        chunks.push(value);
      }
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return text ? JSON.parse(text) : null;
  } catch {
    throw new VsSyncError(method === "GET" ? "invalid_snapshot" : "uncertain", response.status);
  } finally {
    reader?.releaseLock();
  }
}

async function verifyAshedAccess(
  context: VsOpponentAshedContext,
): Promise<void> {
  const [user, upstream] = await Promise.all([
    ashedMetaFetch(context, "/entities/User/me", "GET"),
    ashedMetaFetch(
      context,
      `/entities/Alliance/${encodeURIComponent(context.allianceId)}`,
      "GET",
    ),
  ]);
  if (
    !user ||
    typeof user !== "object" ||
    !("email" in user) ||
    typeof (user as { email?: unknown }).email !== "string" ||
    !upstream ||
    typeof upstream !== "object"
  ) {
    throw new VsSyncError("credentials_required");
  }
  const row = upstream as Record<string, unknown>;
  if (
    row.id !== context.allianceId ||
    (row.collaborators != null &&
      (!Array.isArray(row.collaborators) ||
        !row.collaborators.every((value) => typeof value === "string")))
  ) {
    throw new VsSyncError("credentials_required");
  }
  const access = userAllianceAccessRole(
    {
      id: context.allianceId,
      tag: typeof row.tag === "string" ? row.tag : "",
      owner_email:
        typeof row.owner_email === "string" ? row.owner_email : undefined,
      owner_id:
        typeof row.owner_id === "string" ? row.owner_id : undefined,
      collaborators: (row.collaborators ?? []) as string[],
    },
    {
      email: (user as { email: string }).email,
      id:
        "id" in user && typeof (user as { id?: unknown }).id === "string"
          ? (user as { id: string }).id
          : undefined,
    },
  );
  if (!access) throw new VsSyncError("credentials_required");
}

export async function loadVsAllianceLink(
  allianceId: string,
): Promise<{ ashedAllianceId: string } | null> {
  const [alliance] = await getDb()
    .select({
      ashedAllianceId: schema.alliances.ashedAllianceId,
      operatingMode: schema.alliances.operatingMode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  if (
    !alliance?.ashedAllianceId ||
    alliance.operatingMode === "native"
  ) {
    return null;
  }
  return { ashedAllianceId: alliance.ashedAllianceId };
}

export async function resolveVsOpponentSyncContext(
  actor: VsActor,
  deadline?: number,
): Promise<VsOpponentAshedContext | null> {
  const link = await loadVsAllianceLink(actor.allianceId);
  if (!link) return null;

  const resolved = await resolveAshedConnectionForAlliance(
    actor.sessionId,
    actor.allianceId,
  );
  if (resolved?.isDelegated) {
    try {
      const granted = await requireActiveShareCapability({
        sessionId: actor.sessionId,
        allianceId: actor.allianceId,
        capability: "data_management:write",
        delegatedAction: "vs.matchup.sync",
      });
      const context = {
        connection: granted.connection,
        allianceId: link.ashedAllianceId,
        deadline,
      };
      await verifyAshedAccess(context);
      return context;
    } catch (error) {
      if (error instanceof VsSyncError) throw error;
      if (error instanceof CredentialShareError) {
        throw new VsSyncError("credentials_required");
      }
      throw new VsSyncError("credentials_required");
    }
  }
  if (resolved) {
    const context = {
      connection: resolved.connection,
      allianceId: link.ashedAllianceId,
      deadline,
    };
    await verifyAshedAccess(context);
    return context;
  }

  const installed = await resolveVsAshedConnection(actor.allianceId);
  if (installed) {
    return {
      connection: installed.connection,
      allianceId: installed.allianceId,
      deadline,
    };
  }
  return null;
}

export async function resolveVsScoreReadContext(
  actor: VsActor,
): Promise<{ connection: ParsedConnection; ashedAllianceId: string } | null> {
  const context = await resolveVsOpponentSyncContext(actor);
  return context ? { connection: context.connection, ashedAllianceId: context.allianceId } : null;
}

export async function vsAshedSyncEligibility(
  actor: VsActor,
): Promise<boolean> {
  try {
    const link = await loadVsAllianceLink(actor.allianceId);
    if (!link) return false;
    const resolved = await resolveAshedConnectionForAlliance(
      actor.sessionId,
      actor.allianceId,
    );
    if (resolved) return true;
    const [credential] = await getDb()
      .select({
        tokenExpiresAt: schema.allianceAshedCredentials.tokenExpiresAt,
      })
      .from(schema.allianceAshedCredentials)
      .where(eq(schema.allianceAshedCredentials.allianceId, actor.allianceId))
      .limit(1);
    return Boolean(
      credential &&
        (!credential.tokenExpiresAt ||
          credential.tokenExpiresAt.getTime() > Date.now()),
    );
  } catch {
    return false;
  }
}

export async function fetchAshedOpponentMeta(
  context: VsOpponentAshedContext,
): Promise<AshedOpponentSnapshot[]> {
  const deadline = context.deadline ?? Date.now() + META_SYNC_DEADLINE_MS;
  const seen = new Set<string>();
  const out: AshedOpponentSnapshot[] = [];
  for (
    let skip = 0;
    skip < META_LIST_PAGE_SIZE * META_LIST_MAX_PAGES;
    skip += META_LIST_PAGE_SIZE
  ) {
    if (Date.now() > deadline) throw new VsSyncError("failed");
    const params = new URLSearchParams({
      q: JSON.stringify({ alliance_id: context.allianceId }),
      sort: "id",
      limit: String(META_LIST_PAGE_SIZE),
      skip: String(skip),
    });
    const body = await ashedMetaFetch(
      context,
      `/entities/VSCompetitionMeta?${params}`,
      "GET",
    );
    if (!Array.isArray(body)) throw new VsSyncError("invalid_snapshot");
    for (const raw of body) {
      if (
        raw &&
        typeof raw === "object" &&
        (raw as { is_sample?: unknown }).is_sample === true
      ) {
        continue;
      }
      const id =
        raw && typeof raw === "object"
          ? (raw as { id?: unknown }).id
          : undefined;
      if (typeof id === "string" && seen.has(id)) {
        throw new VsSyncError("invalid_snapshot");
      }
      if (typeof id === "string") seen.add(id);
      let snapshot: AshedOpponentSnapshot;
      try {
        snapshot = parseAshedOpponentRow(raw, context.allianceId);
      } catch (error) {
        if (error instanceof VsPerformanceError) {
          throw new VsSyncError("invalid_snapshot");
        }
        throw error;
      }
      out.push(snapshot);
    }
    if (body.length < META_LIST_PAGE_SIZE) return out;
  }
  throw new VsSyncError("invalid_snapshot");
}

export async function findAshedWeekRecord(
  context: VsOpponentAshedContext,
  weekStart: string,
): Promise<AshedOpponentSnapshot | null> {
  const rows = await fetchAshedOpponentMeta(context);
  const matches = rows.filter((row) => row.weekStart === weekStart);
  if (matches.length > 1) {
    throw new VsSyncError("conflict");
  }
  return matches[0] ?? null;
}

export async function revalidateVsOpponentSyncContext(actor: VsActor, context: VsOpponentAshedContext): Promise<void> {
  const current = await resolveVsOpponentSyncContext(actor, context.deadline);
  if (!current || current.allianceId !== context.allianceId || current.connection.appId !== context.connection.appId || current.connection.originUrl !== context.connection.originUrl || current.connection.token !== context.connection.token) throw new VsSyncError("credentials_required");
  if (context.deadline && Date.now() >= context.deadline) throw new VsSyncError("failed");
}

export async function createAshedOpponentMeta(
  context: VsOpponentAshedContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  return ashedMetaFetch(context, "/entities/VSCompetitionMeta", "POST", body);
}

export async function updateAshedOpponentMeta(
  context: VsOpponentAshedContext,
  remoteId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return ashedMetaFetch(
    context,
    `/entities/VSCompetitionMeta/${encodeURIComponent(remoteId)}`,
    "PUT",
    body,
  );
}
