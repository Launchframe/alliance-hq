import "server-only";

import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export async function ensureOfficerIntelCorpusBackfill(_allianceId: string): Promise<void> {
  throw new KnowledgeAccessError("not_configured");
}
