import { getOrCreateSession } from "@/lib/session";
import {
  createVideoJobListenClient,
  parseVideoJobStatusEvent,
  VIDEO_JOB_NOTIFY_CHANNEL,
} from "@/lib/events/video-jobs";
import { getRecentOwnedVideoJobs } from "@/lib/events/video-jobs-query";
import { isVideoJobStatusEventForViewer } from "@/lib/video/video-job-access.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Close before Vercel's 300s function limit to avoid runtime timeout errors. */
export const SSE_MAX_CONNECTION_MS = 240_000;

export function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const sessionId = session.id;
  const hqUserId = session.hqUserId;

  const encoder = new TextEncoder();
  let closed = false;
  let listenClient: ReturnType<typeof createVideoJobListenClient> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(sseChunk(event, data)));
      };

      const closeStream = (options?: { reconnect?: boolean }) => {
        if (closed) {
          return;
        }
        if (options?.reconnect) {
          send("reconnect", { t: Date.now() });
        }
        closed = true;
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

      try {
        const jobs = await getRecentOwnedVideoJobs(sessionId, hqUserId);
        send("snapshot", { jobs });
      } catch (error) {
        send("error", {
          message:
            error instanceof Error ? error.message : "Failed to load jobs",
        });
      }

      listenClient = createVideoJobListenClient();

      reconnectTimer = setTimeout(
        () => closeStream({ reconnect: true }),
        SSE_MAX_CONNECTION_MS,
      );

      heartbeat = setInterval(() => {
        send("ping", { t: Date.now() });
      }, 25_000);

      void listenClient.listen(VIDEO_JOB_NOTIFY_CHANNEL, (payload) => {
        const event = parseVideoJobStatusEvent(payload);
        if (
          !event ||
          !isVideoJobStatusEventForViewer(event, sessionId, hqUserId)
        ) {
          return;
        }
        send("job", event);
      });

      request.signal.addEventListener("abort", () => {
        closeStream();
      });
    },
    cancel() {
      closed = true;
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
