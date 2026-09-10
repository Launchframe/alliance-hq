/**
 * GET /api/officer-intel/action-items
 */

import { NextResponse } from "next/server";

import { listOpenOfficerActionItems } from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  const items = await listOpenOfficerActionItems(context.allianceId);
  return NextResponse.json({ items });
}
