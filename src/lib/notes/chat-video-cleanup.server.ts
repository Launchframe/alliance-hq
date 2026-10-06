import "server-only";

import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage";

export async function cleanupExpiredChatVideoSources(limit = 25): Promise<{ deleted: number; failed: number }> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const now = new Date();
  const candidates = await getDb().select({
    importId: schema.knowledgeHistoryImports.id,
    allianceId: schema.knowledgeHistoryImports.allianceId,
    assetId: schema.knowledgeHistoryAssets.id,
    sealedKey: schema.knowledgeHistoryAssets.sealedKey,
  }).from(schema.knowledgeHistoryImports)
    .innerJoin(schema.knowledgeHistoryAssets, and(
      eq(schema.knowledgeHistoryAssets.importId, schema.knowledgeHistoryImports.id),
      eq(schema.knowledgeHistoryAssets.allianceId, schema.knowledgeHistoryImports.allianceId),
    ))
    .where(and(
      eq(schema.knowledgeHistoryImports.kind, "video"),
      eq(schema.knowledgeHistoryImports.state, "committed"),
      isNotNull(schema.knowledgeHistoryImports.sourceDeleteAfter),
      lte(schema.knowledgeHistoryImports.sourceDeleteAfter, now),
      isNull(schema.knowledgeHistoryImports.sourceDeletedAt),
      isNotNull(schema.knowledgeHistoryAssets.sealedKey),
    ))
    .orderBy(asc(schema.knowledgeHistoryImports.sourceDeleteAfter), asc(schema.knowledgeHistoryImports.id))
    .limit(safeLimit);

  const result = { deleted: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      await deleteObject(candidate.sealedKey!);
      await getDb().transaction(async (tx) => {
        const importUpdate = await tx.update(schema.knowledgeHistoryImports)
          .set({ sourceDeletedAt: now, updatedAt: now })
          .where(and(
            eq(schema.knowledgeHistoryImports.id, candidate.importId),
            eq(schema.knowledgeHistoryImports.allianceId, candidate.allianceId),
            eq(schema.knowledgeHistoryImports.kind, "video"),
            eq(schema.knowledgeHistoryImports.state, "committed"),
            isNull(schema.knowledgeHistoryImports.sourceDeletedAt),
            lte(schema.knowledgeHistoryImports.sourceDeleteAfter, now),
          )).returning({ id: schema.knowledgeHistoryImports.id });
        if (!importUpdate.length) throw new Error("chat_cleanup_lost");
        const assetUpdate = await tx.update(schema.knowledgeHistoryAssets)
          .set({ sealedKey: null, sealedAt: null, r2UploadId: null })
          .where(and(
            eq(schema.knowledgeHistoryAssets.id, candidate.assetId),
            eq(schema.knowledgeHistoryAssets.importId, candidate.importId),
            eq(schema.knowledgeHistoryAssets.allianceId, candidate.allianceId),
            eq(schema.knowledgeHistoryAssets.sealedKey, candidate.sealedKey!),
          )).returning({ id: schema.knowledgeHistoryAssets.id });
        if (!assetUpdate.length) throw new Error("chat_cleanup_lost");
      });
      result.deleted++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
