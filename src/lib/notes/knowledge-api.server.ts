import "server-only";

import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse, type KnowledgeWebActor } from "./access.server";
import { KnowledgeAccessError } from "./resources.server";

export async function knowledgeApi(action: (actor: KnowledgeWebActor) => Promise<unknown>) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json(await action(context.actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "rate_limited") return notesErrorResponse(new KnowledgeAccessError("rate_limited"));
    return notesErrorResponse(error);
  }
}
export async function readKnowledgeJson(request: Request, maxBytes = 8192): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json") || Number(request.headers.get("content-length")) > maxBytes || !request.body) throw new KnowledgeAccessError("invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new KnowledgeAccessError("invalid"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new KnowledgeAccessError("invalid"); }
  finally { reader.releaseLock(); }
}
