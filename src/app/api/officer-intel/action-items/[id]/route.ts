/**
 * PATCH /api/officer-intel/action-items/[id]
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOfficerActionItem } from "@/lib/officer-intel/repository.server";
import { requireOfficerIntelAllianceContext, requireOfficerIntelWrite } from "@/lib/officer-intel/route-helpers.server";
import { taskPatchSchema } from "@/lib/notes/tasks.shared";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
const patchSchema = taskPatchSchema.omit({ expectedVersion: true }).extend({
  expectedVersion: z.number().int().positive(),
  assigneeAllianceMemberId: z.string().min(1).max(120).nullable().optional(), dueHint: z.string().max(200).nullable().optional(),
});

export async function PATCH(request: Request, { params }: Props) {
  try {
    const context = await requireOfficerIntelAllianceContext();
    if ("error" in context && context.error) return context.error;
    const denied = await requireOfficerIntelWrite(context.sessionId);
    if (denied) return denied;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const fields = parsed.data;
    const result = await updateOfficerActionItem({ ...fields, actor: context.actor, actionItemId: (await params).id, allianceId: context.allianceId, dueAt: fields.dueAt === undefined ? undefined : fields.dueAt ? new Date(fields.dueAt) : null });
    if ("error" in result) throw new KnowledgeAccessError("not_found");
    return NextResponse.json({ ok: true, item: result.item }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
