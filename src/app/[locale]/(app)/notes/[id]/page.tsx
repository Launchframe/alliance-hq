import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
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
  await requirePagePermission(session.id, "members:write");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const note = await getPerformanceNoteDto({ noteId: id, allianceId });
  if (!note) notFound();

  const [notes, roster] = await Promise.all([
    listPerformanceNotes(allianceId),
    listPerformanceNoteRoster(allianceId),
  ]);

  return <NotesClient initial={{ notes, roster }} focusNoteId={id} />;
}
