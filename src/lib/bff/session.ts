import { NextResponse } from "next/server";

import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";
import {
  getAshedConnection,
  getOrCreateSession,
  loadSession,
  readSessionId,
} from "@/lib/session";

export type BffContext = {
  sessionId: string;
  connection: ParsedConnection;
};

export async function requireBffSession(): Promise<
  BffContext | NextResponse
> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getAshedConnection(sessionId);
  if (!connection) {
    return NextResponse.json(
      { error: "Ashed not connected" },
      { status: 503 },
    );
  }

  return { sessionId, connection };
}

export function base44Url(
  connection: ParsedConnection,
  path: string,
): string {
  const appId = connection.appId || DEFAULT_APP_ID;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://base44.app/api/apps/${appId}${normalized}`;
}

export function base44Headers(connection: ParsedConnection): HeadersInit {
  return {
    Authorization: `Bearer ${connection.token}`,
    "Content-Type": "application/json",
    "X-Origin-Url": connection.originUrl,
  };
}

export async function forwardJson(
  connection: ParsedConnection,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : base44Url(connection, path);
  return fetch(url, {
    ...init,
    headers: {
      ...base44Headers(connection),
      ...(init?.headers ?? {}),
    },
  });
}

export async function sanitizeUpstreamResponse(
  upstream: Response,
): Promise<NextResponse> {
  const text = await upstream.text();
  const redacted = text.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    "[redacted]",
  );

  return new NextResponse(redacted, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function ensureSessionForApi() {
  return getOrCreateSession();
}
