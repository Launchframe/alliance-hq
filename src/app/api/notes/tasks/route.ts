import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { createNoteTask, listNoteTasks, listNoteTaskPage } from "@/lib/notes/tasks.server";
import { taskCreateSchema, taskListFilterSchema } from "@/lib/notes/tasks.shared";
import { listKnowledgePeople } from "@/lib/notes/sharing.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const params = new URL(request.url).searchParams;
    const sourceNoteId = params.get("sourceNoteId") ?? undefined;
    const personalOnly = params.get("personalOnly") === "1" || params.get("personalOnly") === "true";
    if (params.has("format")) {
      if (params.get("format") !== "summary") throw new KnowledgeAccessError("invalid");
      const parsed = taskListFilterSchema.safeParse({ status: params.get("status") ?? "active", label: params.get("label") ?? "", sourceNoteId: sourceNoteId ?? null, personalOnly });
      if (!parsed.success) throw new KnowledgeAccessError("invalid");
      const [{ items, ...page }, people] = await Promise.all([listNoteTaskPage(context.actor, parsed.data, params.get("cursor")), listKnowledgePeople(context.actor, true)]);
      return NextResponse.json({ ...page, tasks: items, people, canCreate: context.actor.canCreate, principalId: context.actor.hqUserId }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [tasks, people] = await Promise.all([listNoteTasks(context.actor, { sourceNoteId, personalOnly }), listKnowledgePeople(context.actor, true)]);
    return NextResponse.json({ tasks, people, canCreate: context.actor.canCreate, principalId: context.actor.hqUserId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext("notes:create");
    if (context instanceof NextResponse) return context;
    const parsed = taskCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return NextResponse.json({ task: await createNoteTask(context.actor, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
