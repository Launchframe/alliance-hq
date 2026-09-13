import "server-only";

import { and, asc, eq, lte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { deleteObject, getObjectSize } from "@/lib/storage";
import { OcrLearningError, ocrIdSchema, ocrStorageKeySchema } from "../benchmark/types.shared";
import type { OcrActor } from "./corpus.server";
import { workerAudit } from "./control-policy.server";

async function deleteVerified(key: string) {
  await deleteObject(key, AbortSignal.timeout(30000));
  try {
    await getObjectSize(key, AbortSignal.timeout(30000));
    throw new OcrLearningError("artifact_cleanup_incomplete", 409);
  } catch (error) {
    const absent = error && typeof error === "object" && ("code" in error && error.code === "ENOENT" || "name" in error && ["NotFound", "NoSuchKey"].includes(String(error.name)));
    if (!absent) throw error;
  }
}

export async function expireWorkerArtifacts(allianceId: string, confirmed: boolean, actor: OcrActor, limit = 20) {
  if (!confirmed || !ocrIdSchema.safeParse(allianceId).success || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new OcrLearningError("confirmation_required");
  const candidates = await getDb().select({ id: schema.ocrWorkerArtifacts.id }).from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.allianceId, allianceId), ne(schema.ocrWorkerArtifacts.state, "deleted"), lte(schema.ocrWorkerArtifacts.expiresAt, new Date()))).orderBy(asc(schema.ocrWorkerArtifacts.expiresAt)).limit(limit);
  const deadline = Date.now() + 150000;
  let deleted = 0, releasedBytes = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    const bytes = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ocr-artifact:${candidate.id}`}, 0))`);
      const [artifact] = await tx.select().from(schema.ocrWorkerArtifacts).where(and(eq(schema.ocrWorkerArtifacts.id, candidate.id), eq(schema.ocrWorkerArtifacts.allianceId, allianceId))).limit(1).for("update");
      if (!artifact || artifact.state === "deleted" || artifact.expiresAt > new Date() || artifact.createdAt.getTime() + 3600000 > Date.now()) return 0;
      const [job] = await tx.select().from(schema.ocrWorkerJobs).where(eq(schema.ocrWorkerJobs.id, artifact.jobId)).limit(1);
      if (!job || job.allianceId !== allianceId || job.leaseExpiresAt && job.leaseExpiresAt.getTime() + 600000 > Date.now()) return 0;
      const stagingPrefix = `ocr-staging/${allianceId}/models/${job.id}/`, sealedPrefix = `ocr-learning/${allianceId}/models/${job.id}/`;
      if (!artifact.stagingKey.startsWith(stagingPrefix) || !artifact.sealedKey.startsWith(sealedPrefix) || !ocrStorageKeySchema.safeParse(artifact.stagingKey.replace(/^ocr-staging\//, "ocr-learning/")).success || !ocrStorageKeySchema.safeParse(artifact.sealedKey).success) throw new OcrLearningError("invalid_worker_artifact", 409);
      await deleteVerified(artifact.stagingKey);
      await deleteVerified(artifact.sealedKey);
      await tx.update(schema.ocrWorkerArtifacts).set({ state: "deleted" }).where(eq(schema.ocrWorkerArtifacts.id, artifact.id));
      await tx.update(schema.ocrModelVersions).set({ state: "revoked" }).where(and(eq(schema.ocrModelVersions.allianceId, allianceId), eq(schema.ocrModelVersions.artifactId, artifact.id)));
      await workerAudit(tx, actor, allianceId, "ocr.worker.artifact_expire", artifact.id, { jobId: job.id, bytes: artifact.bytes * 2 });
      return artifact.bytes * 2;
    });
    if (bytes) { deleted++; releasedBytes += bytes; }
  }
  return { deleted, releasedBytes };
}
