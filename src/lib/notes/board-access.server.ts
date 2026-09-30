import "server-only";

import { NextResponse } from "next/server";
import { requireNotesApiContext } from "./access.server";
import { KnowledgeAccessError } from "./resources.server";

export async function requireNoteBoardContext(write = false) {
  const context = await requireNotesApiContext();
  if (context instanceof NextResponse) return context;
  if (!context.actor.canReadBoards || write && !context.actor.canWriteBoards) throw new KnowledgeAccessError("forbidden");
  return context;
}
