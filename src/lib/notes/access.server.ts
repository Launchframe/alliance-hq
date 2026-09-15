import "server-only";

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { getRbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { loadSession, requireApiSession } from "@/lib/session";
import type { KnowledgeActor } from "./policy.shared";
import { claimDiscordKnowledgeResources, knowledgeAccessCondition, KnowledgeAccessError } from "./resources.server";

export type KnowledgeWebActor = KnowledgeActor & { sessionId: string; canCreate: boolean; canReadBoards: boolean; canWriteBoards: boolean };

export async function getKnowledgeActorForSession(sessionId: string): Promise<KnowledgeWebActor | null> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) return null;
  const signedIn = await auth();
  if (signedIn?.user?.id !== session.hqUserId) return null;
  const actor = await resolveBoundKnowledgeActor(sessionId, session.hqUserId);
  if (actor) await claimDiscordKnowledgeResources(actor);
  return actor;
}

async function resolveBoundKnowledgeActor(sessionId: string, hqUserId: string): Promise<KnowledgeWebActor | null> {
  const session = await loadSession(sessionId);
  if (!session || session.hqUserId !== hqUserId) return null;
  const context = await getRbacContext(sessionId);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !context?.roleName || context.hqUserId !== session.hqUserId || context.currentAllianceId !== allianceId || !context.permissions.has("notes:read") || !context.permissions.has("members:read")) return null;
  const isOfficer = ["owner", "maintainer", "officer"].includes(context.roleName);
  const actor: KnowledgeWebActor = {
    kind: "web", sessionId, allianceId, hqUserId: session.hqUserId, discordUserId: null,
    isOfficer, canCreate: isOfficer && context.permissions.has("notes:create"),
    canReadBoards: isOfficer && context.permissions.has("notes_boards:read"),
    canWriteBoards: isOfficer && context.permissions.has("notes_boards:read") && context.permissions.has("notes_boards:write"),
    readableBoardIds: [], editableBoardIds: [],
  };
  if (actor.canReadBoards) {
    const boards = await getDb().select({ id: schema.knowledgeBoards.id }).from(schema.knowledgeBoards)
      .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, schema.knowledgeBoards.resourceId), eq(schema.knowledgeResources.allianceId, allianceId), isNull(schema.knowledgeResources.archivedAt)))
      .where(and(eq(schema.knowledgeBoards.allianceId, allianceId), knowledgeAccessCondition(actor, schema.knowledgeBoards.resourceId)));
    actor.readableBoardIds = boards.map((board) => board.id);
    actor.editableBoardIds = actor.canWriteBoards ? actor.readableBoardIds : [];
  }
  return actor;
}

export async function getKnowledgeActorForGenerationJob(id: string): Promise<KnowledgeWebActor | null> {
  const [job] = await getDb().select().from(schema.knowledgeGenerationJobs).where(eq(schema.knowledgeGenerationJobs.id, id));
  if (!job) return null;
  const [owner] = await getDb().select({ id: schema.knowledgeResources.id }).from(schema.knowledgeResources).where(and(eq(schema.knowledgeResources.id, job.resourceId), eq(schema.knowledgeResources.ownerHqUserId, job.requesterId), eq(schema.knowledgeResources.ownershipState, "hq"), isNull(schema.knowledgeResources.archivedAt)));
  if (!owner) return null;
  const actor = await resolveBoundKnowledgeActor(job.sessionId, job.requesterId);
  return actor?.allianceId === job.allianceId ? actor : null;
}

export async function requireNotesApiContext(permission: "notes:read" | "notes:create" = "notes:read") {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const denied = await requireSessionPermission(session.id, permission);
  if (denied) return denied;
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor || (permission === "notes:create" && !actor.canCreate)) {
    const t = await getTranslations("notes");
    return NextResponse.json({ error: t("errors.forbidden"), code: "forbidden" }, { status: 403 });
  }
  return { session, actor };
}

export async function notesErrorResponse(error: unknown) {
  const t = await getTranslations("notes");
  if (error instanceof KnowledgeAccessError) {
    const keys = { not_found: "notFound", changed: "errors.conflict", invalid: "errors.invalid", forbidden: "errors.forbidden", assignee_access: "tasks.assigneeAccess", intake_disabled: "intake.disabled", not_configured: "intake.unavailable", rate_limited: "intake.rateLimited", invalid_analysis: "intake.failed" } as const;
    const key = keys[error.code];
    return NextResponse.json({ error: t(key), code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: t("saveFailed"), code: "failed" }, { status: 500 });
}
