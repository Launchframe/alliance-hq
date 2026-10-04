import postgres from "postgres";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getListenDatabaseUrl } from "@/lib/db/url";
import { startPostgresListen } from "@/lib/db/postgres-listen";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { supportErrorResponse } from "@/lib/support-teams/route-helpers.server";
import { SupportError } from "@/lib/support-teams/types.shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireSupportAccess();
    if (!access.actor.canRead) throw new SupportError("forbidden");
    const client = postgres(getListenDatabaseUrl(), { prepare: false, max: 1 });
    const encoder = new TextEncoder();
    let closed = false;
    let stopProbe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let finish: (() => void) | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      stopProbe?.();
      clearInterval(heartbeat);
      clearTimeout(deadline);
      request.signal.removeEventListener("abort", abort);
      void client.end({ timeout: 0 }).catch(() => undefined);
    };
    const abort = () => finish?.();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        finish = () => { if (!closed) { cleanup(); controller.close(); } };
        const send = (event: string, version: number) => {
          if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify({ allianceId: access.actor.allianceId, version })}\n\n`));
        };
        const refresh = async (event: string) => {
          if (closed) return;
          try {
            const current = await requireSupportAccess();
            if (!current.actor.canRead || current.actor.allianceId !== access.actor.allianceId || current.actor.principalId !== access.actor.principalId) { finish?.(); return; }
            const [row] = await getDb().select({ version: schema.supportTeamBoards.version }).from(schema.supportTeamBoards).where(eq(schema.supportTeamBoards.allianceId, access.actor.allianceId));
            send(event, row?.version ?? 0);
          } catch { finish?.(); }
        };
        request.signal.addEventListener("abort", abort);
        if (request.signal.aborted) { finish(); return; }
        deadline = setTimeout(() => finish?.(), 240_000);
        stopProbe = await startPostgresListen(client, "support_team_changes", (payload) => {
          try {
            const value: unknown = JSON.parse(payload);
            if (value && typeof value === "object" && "allianceId" in value && value.allianceId === access.actor.allianceId) void refresh("invalidate");
          } catch { return; }
        }, () => finish?.(), { isIntentionalClose: () => closed, onDisconnect: () => finish?.() });
        if (closed) { stopProbe(); return; }
        await refresh("ready");
        if (!closed) heartbeat = setInterval(() => { void refresh("invalidate"); }, 25_000);
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", Connection: "keep-alive" } });
  } catch (error) { return supportErrorResponse(error); }
}
