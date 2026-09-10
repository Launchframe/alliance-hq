import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { NotesClient } from "@/components/notes/NotesClient";
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
  await requirePagePermission(session.id, "members:write");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const [notes, roster] = await Promise.all([
    listPerformanceNotes(allianceId),
    listPerformanceNoteRoster(allianceId),
  ]);

  return <NotesClient initial={{ notes, roster }} />;
}
