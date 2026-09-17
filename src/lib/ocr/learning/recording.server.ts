import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import { frameStorageKey } from "@/lib/storage";
import { stableJson } from "../benchmark/json.shared";
import { OcrLearningError, ocrHashSchema, type OcrTarget } from "../benchmark/types.shared";
import { snapshotReviewRows } from "./feedback.shared";
import { buildObservations, type OcrRunManifest } from "./observations.shared";

export type OcrTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export const ocrContentHash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");

export async function recordPipelineRun(input: {
  jobId: string; parseSessionId: string; allianceId: string; scoreTarget: OcrTarget; engine: string;
  sourceSha256?: string | null; sourceKind: OcrRunManifest["sourceKind"]; extractionConfig: unknown;
  frames: Array<{ index: number; buffer: Buffer; videoTimestampSeconds: number | null }>;
  entries: OcrEntry[];
}) {
  const config = input.extractionConfig && typeof input.extractionConfig === "object" ? input.extractionConfig as Record<string, unknown> : {};
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const frames = input.frames.slice(0, 2000).map((frame) => ({
    index: frame.index, sha256: createHash("sha256").update(frame.buffer).digest("hex"), bytes: frame.buffer.length,
    storageKey: frameStorageKey(input.jobId, frame.index), timestampSeconds: frame.videoTimestampSeconds,
    timestampProvenance: "legacy_extractor" as const,
  }));
  const observations = buildObservations(input.entries, frames);
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.OCR_PIPELINE_REVISION;
  return getDb().transaction(async (tx) => {
    const [session] = await tx.select().from(schema.parseSessions).where(and(eq(schema.parseSessions.id, input.parseSessionId), eq(schema.parseSessions.jobId, input.jobId), eq(schema.parseSessions.allianceId, input.allianceId))).limit(1);
    if (!session || session.scoreTarget !== input.scoreTarget) throw new OcrLearningError("run_scope_mismatch", 409);
    const rows = await tx.select().from(schema.parsedRows).where(eq(schema.parsedRows.parseSessionId, input.parseSessionId));
    const manifest: OcrRunManifest = {
      version: 1, engine: input.engine, codeRevision: revision && /^[a-f0-9]{40,64}$/.test(revision) ? revision : null,
      requestedExtraction: { mode: typeof config.mode === "string" ? config.mode.slice(0, 30) : null, sceneThreshold: numeric(config.sceneThreshold), sampleFps: numeric(config.sampleFps), supplementFps: numeric(config.supplementFps) },
      sourceSha256: ocrHashSchema.safeParse(input.sourceSha256).success ? input.sourceSha256! : null,
      sourceKind: input.sourceKind, synthetic: input.engine === "mock", frames,
      ...observations, observationsTruncated: observations.observationsTruncated || input.frames.length > 2000,
      initialRows: snapshotReviewRows(rows.slice(0, 2000)), initialRowsTruncated: rows.length > 2000,
    };
    const id = nanoid();
    const [created] = await tx.insert(schema.ocrPipelineRuns).values({ id, jobId: input.jobId, parseSessionId: input.parseSessionId, allianceId: input.allianceId, scoreTarget: input.scoreTarget, engine: input.engine, synthetic: manifest.synthetic, sourceSha256: manifest.sourceSha256, manifest, manifestHash: ocrContentHash(manifest) }).onConflictDoNothing({ target: schema.ocrPipelineRuns.parseSessionId }).returning({ id: schema.ocrPipelineRuns.id });
    if (created) return created.id;
    const [existing] = await tx.select().from(schema.ocrPipelineRuns).where(eq(schema.ocrPipelineRuns.parseSessionId, input.parseSessionId)).limit(1);
    if (!existing || existing.jobId !== input.jobId || existing.allianceId !== input.allianceId || existing.scoreTarget !== input.scoreTarget) throw new OcrLearningError("run_scope_mismatch", 409);
    return existing.id;
  });
}
