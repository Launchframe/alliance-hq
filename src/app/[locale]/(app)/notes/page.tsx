import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
import { getKnowledgeActorForSession } from "@/lib/notes/access.server";
import {
  listPerformanceNoteRoster,
  listPerformanceNotes,
} from "@/lib/performance-notes/repository.server";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("notes");
  return { title: t("title") };
}

export default async function NotesPage() {
  const session = await requirePageSession("/notes");
  await requirePagePermission(session.id, "notes:read");
  const actor = await getKnowledgeActorForSession(session.id);
  if (!actor) notFound();

  const [notes, roster] = await Promise.all([
    listPerformanceNotes(actor),
    listPerformanceNoteRoster(actor.allianceId),
  ]);

  return <NotesClient key={`${actor.allianceId}:${actor.hqUserId}:list`} initial={{ notes, roster, canCreate: actor.canCreate }} />;
}
