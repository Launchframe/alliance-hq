import "server-only";

import { and, asc, eq, lte, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { deleteObject, getObjectSize } from "@/lib/storage";
import { OcrLearningError, ocrIdSchema } from "../benchmark/types.shared";
import type { OcrActor } from "./corpus.server";
import { lockMedia } from "./media-queue.server";

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "ENOENT" || "name" in error && (error.name === "NotFound" || error.name === "NoSuchKey");
}

export async function expireMediaObjects(allianceId: string, confirmed: boolean, actor: OcrActor, limit = 20) {
  if (!confirmed || !ocrIdSchema.safeParse(allianceId).success || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new OcrLearningError("confirmation_required");
  const objects = await getDb().select().from(schema.ocrMediaObjects).where(and(eq(schema.ocrMediaObjects.allianceId, allianceId), ne(schema.ocrMediaObjects.state, "deleted"), lte(schema.ocrMediaObjects.deleteAfter, new Date()))).orderBy(asc(schema.ocrMediaObjects.deleteAfter)).limit(limit);
  let deleted = 0, bytes = 0;
  const deadline = Date.now() + 200000;
  for (const object of objects) {
    if (Date.now() >= deadline) break;
    const result = await getDb().transaction(async (tx) => {
      await lockMedia(tx, allianceId);
      const [current] = await tx.select().from(schema.ocrMediaObjects).where(eq(schema.ocrMediaObjects.storageKey, object.storageKey)).limit(1).for("update");
      const [task] = await tx.select().from(schema.ocrMediaTasks).where(eq(schema.ocrMediaTasks.id, object.taskId)).limit(1);
      if (!current || !task || current.state === "deleted" || current.deleteAfter > new Date()) return false;
      if (task.leaseExpiresAt && task.leaseExpiresAt.getTime() + 10 * 60000 > Date.now()) return false;
      if (current.kind !== "staging" && task.expiresAt > new Date()) return false;
      const prefix = `${current.kind === "staging" ? "ocr-staging" : "ocr-learning"}/${allianceId}/${task.id}/`;
      if (!current.storageKey.startsWith(prefix) || current.storageKey.split("/").some((part) => !part || part === "." || part === "..")) throw new OcrLearningError("invalid_media", 409);
      await deleteObject(current.storageKey, AbortSignal.timeout(30000));
      try {
        await getObjectSize(current.storageKey, AbortSignal.timeout(30000));
        throw new OcrLearningError("media_cleanup_incomplete", 409);
      } catch (error) {
        if (!missingObject(error)) throw error;
      }
      await tx.update(schema.ocrMediaObjects).set({ state: "deleted", updatedAt: new Date() }).where(eq(schema.ocrMediaObjects.storageKey, current.storageKey));
      await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId, hqUserId: actor.hqUserId, sessionId: actor.sessionId, action: "ocr.media.expire", severity: "update", resourceType: "ocr_media", resourceId: task.id, metadata: { kind: current.kind, bytes: current.reservedBytes } });
      return true;
    });
    if (result) { deleted++; bytes += object.reservedBytes; }
  }
  return { deleted, releasedBytes: bytes };
}
