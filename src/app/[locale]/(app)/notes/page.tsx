import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
import { getKnowledgeActorForSession } from "@/lib/notes/access.server";
import { countCaptureDrafts } from "@/lib/notes/drafts.server";
import { claimDiscordKnowledgeResources } from "@/lib/notes/resources.server";
import { loadWorkspaceQuery } from "@/lib/notes/preferences.server";
import { loadNotePageQuery } from "@/lib/notes/page-query.server";
import { getPerformanceNoteDto, listPerformanceNoteRoster } from "@/lib/performance-notes/repository.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("notes");
  return { title: t("title") };
}

export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePageSession("/notes");
  await requirePagePermission(session.id, "notes:read");
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor) notFound();
  await claimDiscordKnowledgeResources(actor);
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]]));
  const { preferences, filter, cursor } = await loadWorkspaceQuery(actor, params);
  const [{ page, cursor: initialCursor }, roster, drafts, focusedNote] = await Promise.all([
    loadNotePageQuery(actor, new URLSearchParams({ ...filter, ...(cursor ? { cursor: JSON.stringify(cursor) } : {}) })),
    listPerformanceNoteRoster(actor.allianceId), countCaptureDrafts(actor),
    params.get("note") ? getPerformanceNoteDto({ noteId: params.get("note")!, actor }) : null,
  ]);
  return <NotesClient key={`${actor.allianceId}:${actor.hqUserId}:list`} initial={{ ...page, preferences, roster, canCreate: actor.canCreate, canReadBoards: actor.canReadBoards, draftCount: drafts }} initialCursor={initialCursor} focusedNote={focusedNote} />;
}
