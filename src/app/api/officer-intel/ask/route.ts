/**
 * POST /api/officer-intel/ask
 */

import { notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { requireOfficerIntelAllianceContext, requireOfficerIntelRead } from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;
  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;
  return notesErrorResponse(new KnowledgeAccessError("not_configured"));
}
