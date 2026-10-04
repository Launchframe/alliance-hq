import "server-only";

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { getRbacContext } from "@/lib/rbac/context";
import { listLinkedCommanderIdsForHqUser } from "@/lib/time-off/repository.server";
import { SupportError, type SupportActor } from "./types.shared";

export type SupportAccess = { actor: SupportActor; sessionId: string; canViewPublished: boolean };
export async function requireSupportAccess(required: "published" | "read" | "write" = "published"): Promise<SupportAccess> {
  const session = await requireApiSession();
  if (session instanceof NextResponse || !session.hqUserId || !session.currentAllianceId) throw new SupportError("forbidden");
  const context = await getRbacContext(session.id);
  if (!context || context.currentAllianceId !== session.currentAllianceId) throw new SupportError("forbidden");
  const override = context.isPlatformMaintainer || context.roleName === "owner";
  if (context.hqUserId !== session.hqUserId && !context.isPlatformMaintainer) throw new SupportError("forbidden");
  const canRead = override || context.permissions.has("support_teams:read");
  const canWrite = override || context.permissions.has("support_teams:write");
  const canViewPublished = canRead || (context.roleName !== null && context.permissions.has("members:read"));
  if (!canViewPublished || (required !== "published" && !canRead) || (required === "write" && !canWrite)) throw new SupportError("forbidden");
  return { sessionId: session.id, canViewPublished, actor: { allianceId: session.currentAllianceId, principalId: session.hqUserId, displayName: context.hqUserId === session.hqUserId ? context.displayName : null, canRead, canWrite, override, linkedMemberIds: await listLinkedCommanderIdsForHqUser({ allianceId: session.currentAllianceId, hqUserId: session.hqUserId }) } };
}
