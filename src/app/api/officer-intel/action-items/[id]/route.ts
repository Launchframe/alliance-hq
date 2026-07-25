/**
 * PATCH /api/officer-intel/action-items/[id]
 */

import { NextResponse } from "next/server";

import { updateOfficerActionItem } from "@/lib/officer-intel/repository.server";
import type {
  OfficerActionItemPriority,
  OfficerActionItemStatus,
} from "@/lib/officer-intel/synthesis-types.shared";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const STATUSES = new Set<OfficerActionItemStatus>([
  "open",
  "in_progress",
  "done",
  "cancelled",
]);
const PRIORITIES = new Set<OfficerActionItemPriority>([
  "low",
  "normal",
  "high",
]);

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const status =
    typeof body.status === "string" && STATUSES.has(body.status as OfficerActionItemStatus)
      ? (body.status as OfficerActionItemStatus)
      : undefined;
  const priority =
    typeof body.priority === "string" &&
    PRIORITIES.has(body.priority as OfficerActionItemPriority)
      ? (body.priority as OfficerActionItemPriority)
      : undefined;

  let dueAt: Date | null | undefined;
  if (body.dueAt === null) {
    dueAt = null;
  } else if (typeof body.dueAt === "string" && body.dueAt.trim()) {
    const parsed = new Date(body.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid dueAt." }, { status: 400 });
    }
    dueAt = parsed;
  }

  const result = await updateOfficerActionItem({
    actionItemId: id,
    allianceId: context.allianceId,
    title: typeof body.title === "string" ? body.title : undefined,
    description:
      typeof body.description === "string"
        ? body.description
        : body.description === null
          ? null
          : undefined,
    status,
    priority,
    assigneeAllianceMemberId:
      typeof body.assigneeAllianceMemberId === "string"
        ? body.assigneeAllianceMemberId
        : body.assigneeAllianceMemberId === null
          ? null
          : undefined,
    dueAt,
    dueHint:
      typeof body.dueHint === "string"
        ? body.dueHint
        : body.dueHint === null
          ? null
          : undefined,
  });

  if ("error" in result) {
    return NextResponse.json({ error: "Action item not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: result.item });
}
