import { notFound } from "next/navigation";

import { OfficerMeetingNoteClient } from "@/components/officer-intel/OfficerMeetingNoteClient";
import {
  getOfficerChatSessionForAlliance,
  getOfficerMeetingNoteForAlliance,
  listOfficerActionItemsForNote,
} from "@/lib/officer-intel/repository.server";
import {
  OFFICER_INTEL_READ_PERMISSION,
  OFFICER_INTEL_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { sessionHasPermission } from "@/lib/rbac/context";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OfficerMeetingNotePage({ params }: Props) {
  const { id } = await params;
  const session = await requirePageSession(`/officer-intel/notes/${id}`);
  await requirePagePermission(session.id, OFFICER_INTEL_READ_PERMISSION);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const note = await getOfficerMeetingNoteForAlliance({
    noteId: id,
    allianceId,
  });
  if (!note) notFound();

  const [chatSession, actionItems, canWrite] = await Promise.all([
    getOfficerChatSessionForAlliance({
      sessionId: note.sessionId,
      allianceId,
    }),
    listOfficerActionItemsForNote({ noteId: id, allianceId }),
    sessionHasPermission(session.id, OFFICER_INTEL_WRITE_PERMISSION),
  ]);

  return (
    <OfficerMeetingNoteClient
      note={note}
      actionItems={actionItems}
      canWrite={canWrite}
      sessionTitle={chatSession?.title ?? ""}
    />
  );
}
