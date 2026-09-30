import { NextResponse } from "next/server";
import postgres from "postgres";
import { getListenDatabaseUrl } from "@/lib/db/url";
import { startPostgresListen } from "@/lib/db/postgres-listen";
import { requireNoteBoardContext } from "@/lib/notes/board-access.server";
import { noteBoardVersion } from "@/lib/notes/boards.server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireNoteBoardContext();
    if (context instanceof NextResponse) return context;
    const boardId = (await params).id;
    await noteBoardVersion(context.actor, boardId);
    const scope = { allianceId: context.actor.allianceId, boardId, principalId: context.actor.hqUserId };
    const client = postgres(getListenDatabaseUrl(), { prepare: false, max: 1 });
    const encoder = new TextEncoder();
    let closed = false;
    let stopProbe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let finish: (() => void) | undefined;
    const abort = () => finish?.();
    const cleanup = () => {
      if (closed) return;
      closed = true; stopProbe?.(); clearInterval(heartbeat); clearTimeout(deadline);
      request.signal.removeEventListener("abort", abort);
      void client.end({ timeout: 0 }).catch(() => undefined);
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        finish = () => { if (!closed) { cleanup(); controller.close(); } };
        const revoke = () => { if (!closed) controller.enqueue(encoder.encode("event: revoked\ndata: {}\n\n")); finish?.(); };
        const refresh = async (event: string) => {
          if (closed) return;
          try {
            const current = await requireNoteBoardContext();
            if (current instanceof NextResponse || current.actor.allianceId !== scope.allianceId || current.actor.hqUserId !== scope.principalId) { revoke(); return; }
            const version = await noteBoardVersion(current.actor, boardId);
            if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify({ ...scope, version })}\n\n`));
          } catch (error) {
            if (error instanceof KnowledgeAccessError && [401, 403, 404].includes(error.status)) revoke(); else finish?.();
          }
        };
        request.signal.addEventListener("abort", abort);
        if (request.signal.aborted) { finish(); return; }
        deadline = setTimeout(() => finish?.(), 240_000);
        try {
          stopProbe = await startPostgresListen(client, "knowledge_board_changes", (payload) => {
          try {
            const value = JSON.parse(payload);
            if (value?.allianceId === scope.allianceId && value.boardId === boardId) void refresh("invalidate");
          } catch { return; }
          }, () => finish?.(), { isIntentionalClose: () => closed, onDisconnect: () => finish?.() });
        } catch { finish(); return; }
        if (closed) { stopProbe(); return; }
        await refresh("ready");
        if (!closed) heartbeat = setInterval(() => void refresh("invalidate"), 25_000);
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", Connection: "keep-alive" } });
  } catch (error) { return notesErrorResponse(error); }
}
