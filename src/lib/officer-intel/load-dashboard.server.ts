import "server-only";

import { sessionHasPermission } from "@/lib/rbac/context";
import { getKnowledgeActorForSession } from "@/lib/notes/access.server";
import {
  OFFICER_INTEL_READ_PERMISSION,
  OFFICER_INTEL_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import {
  countOpenOfficerActionItems,
  listOfficerChatSessions,
} from "@/lib/officer-intel/repository.server";
import { countApprovedOfficerMeetingNotes } from "@/lib/officer-intel/retrieve-corpus.server";
import type { OfficerIntelDashboardPayload } from "@/lib/officer-intel/types.shared";
import { isOfficerIntelLlmConfigured } from "@/lib/officer-intel/llm-config.server";
import { isTranslationConfigured } from "@/lib/translate/translate.server";

export async function loadOfficerIntelDashboard(
  sessionId: string,
  allianceId: string,
): Promise<OfficerIntelDashboardPayload | null> {
  const canRead = await sessionHasPermission(
    sessionId,
    OFFICER_INTEL_READ_PERMISSION,
  );
  if (!canRead) return null;

  const canWrite = await sessionHasPermission(
    sessionId,
    OFFICER_INTEL_WRITE_PERMISSION,
  );
  const actor = await getKnowledgeActorForSession(sessionId);
  if (!actor || actor.allianceId !== allianceId) return null;
  const sessions = await listOfficerChatSessions(allianceId, actor);
  const openActionItemCount = await countOpenOfficerActionItems(allianceId, actor);
  const approvedNoteCount = await countApprovedOfficerMeetingNotes(allianceId, actor);

  return {
    sessions,
    canWrite,
    translationConfigured: isTranslationConfigured(),
    llmConfigured: isOfficerIntelLlmConfigured(),
    openActionItemCount,
    approvedNoteCount,
  };
}
