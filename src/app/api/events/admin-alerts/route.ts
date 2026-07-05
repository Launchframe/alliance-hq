import { NextResponse } from "next/server";

import {
  ADMIN_ALERT_NOTIFY_CHANNEL,
  adminAlertSseEventName,
  createAdminAlertListenClient,
  parseAdminAlertEvent,
} from "@/lib/events/admin-alerts";
import { startPostgresListen } from "@/lib/db/postgres-listen";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const SSE_MAX_CONNECTION_MS = 240_000;
export const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

export function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const encoder = new TextEncoder();
  let closed = false;
  let intentionalClose = false;
  let listenClient: ReturnType<typeof createAdminAlertListenClient> | null =
    null;
  let stopProbe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseChunk(event, data)));
      };

      const closeStream = (options?: { reconnect?: boolean }) => {
        if (closed) return;
        if (options?.reconnect) {
          send("reconnect", { t: Date.now() });
        }
        intentionalClose = true;
        closed = true;
        stopProbe?.();
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        void listenClient?.end({ timeout: 0 }).catch(() => undefined);
        controller.close();
      };

      const handleListenFailure = () => {
        send("error", { message: "Live updates unavailable" });
        closeStream({ reconnect: true });
      };

      listenClient = createAdminAlertListenClient();

      reconnectTimer = setTimeout(
        () => closeStream({ reconnect: true }),
        SSE_MAX_CONNECTION_MS,
      );

      heartbeat = setInterval(() => {
        send("ping", { t: Date.now() });
      }, SSE_HEARTBEAT_INTERVAL_MS);

      stopProbe = await startPostgresListen(
        listenClient,
        ADMIN_ALERT_NOTIFY_CHANNEL,
        (payload) => {
          const event = parseAdminAlertEvent(payload);
          if (event) send(adminAlertSseEventName(event), event);
        },
        handleListenFailure,
        {
          isIntentionalClose: () => intentionalClose || closed,
          onDisconnect: handleListenFailure,
        },
      );

      request.signal.addEventListener("abort", () => {
        closeStream();
      });
    },
    cancel() {
      intentionalClose = true;
      closed = true;
      stopProbe?.();
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void listenClient?.end({ timeout: 0 }).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
