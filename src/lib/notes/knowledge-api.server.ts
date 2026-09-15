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
    if (error instanceof Error && error.message === "rate_limited") return NextResponse.json({ code: "rate_limited" }, { status: 429, headers: { "Cache-Control": "private, no-store" } });
    return notesErrorResponse(error);
  }
}
export async function readKnowledgeJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json") || Number(request.headers.get("content-length")) > 8192 || !request.body) throw new KnowledgeAccessError("invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new KnowledgeAccessError("invalid"); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new KnowledgeAccessError("invalid"); }
  finally { reader.releaseLock(); }
}
