import { getOrCreateSession } from "@/lib/session";
import {
  createVideoJobListenClient,
  parseVideoJobStatusEvent,
  VIDEO_JOB_NOTIFY_CHANNEL,
} from "@/lib/events/video-jobs";
import type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";
import { getRecentSessionVideoJobs } from "@/lib/events/video-jobs-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const sessionId = session.id;

  const encoder = new TextEncoder();
  let closed = false;
  let listenClient: ReturnType<typeof createVideoJobListenClient> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(sseChunk(event, data)));
      };

      try {
        const jobs = await getRecentSessionVideoJobs(sessionId);
        send("snapshot", { jobs });
      } catch (error) {
        send("error", {
          message:
            error instanceof Error ? error.message : "Failed to load jobs",
        });
      }

      listenClient = createVideoJobListenClient();

      await listenClient.listen(VIDEO_JOB_NOTIFY_CHANNEL, (payload) => {
        const event = parseVideoJobStatusEvent(payload);
        if (!event || event.sessionId !== sessionId) {
          return;
        }
        send("job", event);
      });

      heartbeat = setInterval(() => {
        send("ping", { t: Date.now() });
      }, 25_000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        void listenClient?.end({ timeout: 0 }).catch(() => undefined);
        controller.close();
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
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
