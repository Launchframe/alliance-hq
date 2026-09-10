import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  indexOfficerApprovedNoteCorpus,
  indexOfficerOpenActionItemById,
  listApprovedOfficerMeetingNotesForAlliance,
  listOpenOfficerActionItems,
} from "@/lib/officer-intel/repository.server";

const MAX_NOTE_BACKFILL = 5;
const MAX_ACTION_ITEM_BACKFILL = 20;

async function indexedSourceIds(
  allianceId: string,
  sourceType: "approved_note" | "action_item",
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ sourceId: schema.officerIntelChunks.sourceId })
    .from(schema.officerIntelChunks)
    .where(
      and(
        eq(schema.officerIntelChunks.allianceId, allianceId),
        eq(schema.officerIntelChunks.sourceType, sourceType),
      ),
    );
  return new Set(rows.map((row) => row.sourceId));
}

export async function ensureOfficerIntelCorpusBackfill(
  allianceId: string,
): Promise<void> {
  const indexedNotes = await indexedSourceIds(allianceId, "approved_note");
  const notes = await listApprovedOfficerMeetingNotesForAlliance(allianceId);
  const missingNotes = notes
    .filter((note) => !indexedNotes.has(note.id))
    .slice(0, MAX_NOTE_BACKFILL);
  for (const note of missingNotes) {
    await indexOfficerApprovedNoteCorpus({
      allianceId,
      noteId: note.id,
    });
  }

  const indexedItems = await indexedSourceIds(allianceId, "action_item");
  const items = await listOpenOfficerActionItems(allianceId);
  const missingItems = items
    .filter((item) => !indexedItems.has(item.id))
    .slice(0, MAX_ACTION_ITEM_BACKFILL);
  for (const item of missingItems) {
    await indexOfficerOpenActionItemById({
      allianceId,
      actionItemId: item.id,
    });
  }
}
