import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireNotesApiContext, notesErrorResponse, type KnowledgeWebActor } from "./access.server";
import { KnowledgeAccessError } from "./resources.server";
import { readHistoryStream } from "./import-storage.server";

export async function historyApi(permission: "notes:read" | "notes:create", work: (actor: KnowledgeWebActor) => Promise<unknown>) {
  const context = await requireNotesApiContext(permission);
  if (context instanceof NextResponse) return context;
  try { return NextResponse.json(await work(context.actor), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return notesErrorResponse(error instanceof ZodError || error instanceof SyntaxError ? new KnowledgeAccessError("invalid") : error); }
}
export async function historyJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new KnowledgeAccessError("invalid");
  return JSON.parse((await readHistoryStream(request.body, 3_200_000)).toString("utf8"));
}
