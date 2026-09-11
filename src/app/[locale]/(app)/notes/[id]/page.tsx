import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
import { getKnowledgeActorForSession } from "@/lib/notes/access.server";
import {
  getPerformanceNoteDto,
  listPerformanceNoteRoster,
  listPerformanceNotes,
} from "@/lib/performance-notes/repository.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata() {
  const t = await getTranslations("notes");
  return { title: t("title") };
}

export default async function NoteDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requirePageSession(`/notes/${id}`);
  await requirePagePermission(session.id, "notes:read");
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor) notFound();

  const note = await getPerformanceNoteDto({ noteId: id, actor });
  if (!note) notFound();
  const [notes, roster] = await Promise.all([listPerformanceNotes(actor), listPerformanceNoteRoster(actor.allianceId)]);

  return <NotesClient key={`${actor.allianceId}:${actor.hqUserId}:${id}`} initial={{ notes, roster, canCreate: actor.canCreate }} focusNoteId={id} />;
}
