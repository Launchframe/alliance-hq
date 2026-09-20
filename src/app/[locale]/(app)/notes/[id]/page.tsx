import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
import { getKnowledgeActorForSession } from "@/lib/notes/access.server";
import { countCaptureDrafts } from "@/lib/notes/drafts.server";
import { claimDiscordKnowledgeResources, KnowledgeAccessError } from "@/lib/notes/resources.server";
import { noteRouteId } from "@/lib/notes/workspace.shared";
import { loadWorkspaceQuery } from "@/lib/notes/preferences.server";
import { getPerformanceNoteDto, listPerformanceNoteRoster, listPerformanceNotePage } from "@/lib/performance-notes/repository.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata() {
  const t = await getTranslations("notes");
  return { title: t("title") };
}

export default async function NoteDetailPage({ params, searchParams }: Props) {
  const id = noteRouteId((await params).id);
  const session = await requirePageSession(`/notes/${id}`);
  await requirePagePermission(session.id, "notes:read");
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor) notFound();
  await claimDiscordKnowledgeResources(actor);
  const note = await getPerformanceNoteDto({ noteId: id, actor });
  if (!note) notFound();
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]]));
  const { preferences, filter, cursor } = await loadWorkspaceQuery(actor, query).catch((error) => { if (error instanceof KnowledgeAccessError) notFound(); throw error; });
  const [page, roster, drafts] = await Promise.all([
    listPerformanceNotePage(actor, filter, cursor).catch((error) => { if (error instanceof KnowledgeAccessError) notFound(); throw error; }),
    listPerformanceNoteRoster(actor.allianceId), countCaptureDrafts(actor),
  ]);
  return <NotesClient key={`${actor.allianceId}:${actor.hqUserId}:${id}`} initial={{ ...page, preferences, roster, canCreate: actor.canCreate, canReadBoards: actor.canReadBoards, draftCount: drafts }} focusedNote={note} />;
}
