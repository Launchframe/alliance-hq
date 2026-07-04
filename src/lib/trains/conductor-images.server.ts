import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  getImageGenerationProvider,
} from "@/lib/trains/image-generation";
import type {
  ConductorGeneratedImage,
  ImageModelProvider,
} from "@/lib/trains/prompt-templates.shared";
import { putObject, prefersLocalStorage, r2Configured } from "@/lib/storage";
import { presignR2GetObject } from "@/lib/storage/r2";

function mapGeneratedImageRow(
  row: typeof schema.trainConductorGeneratedImages.$inferSelect,
  downloadUrl: string | null,
): ConductorGeneratedImage {
  return {
    id: row.id,
    conductorRecordId: row.conductorRecordId,
    promptTemplateId: row.promptTemplateId,
    promptBodyUsed: row.promptBodyUsed,
    modelProvider: row.modelProvider as ImageModelProvider,
    modelType: row.modelType,
    quality: row.quality as ConductorGeneratedImage["quality"],
    status: row.status as ConductorGeneratedImage["status"],
    storageKey: row.storageKey,
    downloadUrl,
    externalImageUrls: row.externalImageUrls ?? [],
    selectedExternalUrl: row.selectedExternalUrl,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
  };
}

export function conductorImageStorageKey(input: {
  allianceId: string;
  imageId: string;
}): string {
  return `trains/conductor-images/${input.allianceId}/${input.imageId}.jpg`;
}

export function conductorImageDownloadPath(
  conductorRecordId: string,
  imageId: string,
): string {
  return `/api/trains/conductor/${conductorRecordId}/images/${imageId}/download`;
}

async function resolveDownloadUrl(input: {
  conductorRecordId: string;
  imageId: string;
  storageKey: string;
}): Promise<string> {
  if (r2Configured()) {
    return presignR2GetObject(input.storageKey);
  }
  return conductorImageDownloadPath(input.conductorRecordId, input.imageId);
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  if (url.startsWith("data:image")) {
    const comma = url.indexOf(",");
    if (comma === -1) {
      throw new Error("Invalid data URL for image download.");
    }
    const base64 = url.slice(comma + 1);
    return Buffer.from(base64, "base64");
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Could not download generated image bytes.");
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function generateConductorDraftImages(input: {
  allianceId: string;
  conductorRecordId: string;
  hqUserId: string | null;
  promptBody: string;
  promptTemplateId?: string | null;
  promptTemplateRevisionId?: string | null;
  modelProvider: ImageModelProvider;
  modelType?: string | null;
  portraitUrl?: string | null;
}): Promise<ConductorGeneratedImage> {
  const db = getDb();
  const [record] = await db
    .select({ id: schema.trainConductorRecords.id })
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.conductorRecordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  if (!record) {
    throw new Error("Conductor record not found.");
  }

  const imageId = nanoid();
  const now = new Date();

  await db.insert(schema.trainConductorGeneratedImages).values({
    id: imageId,
    conductorRecordId: input.conductorRecordId,
    promptTemplateId: input.promptTemplateId ?? null,
    promptTemplateRevisionId: input.promptTemplateRevisionId ?? null,
    promptBodyUsed: input.promptBody,
    modelProvider: input.modelProvider,
    modelType: input.modelType ?? "art",
    quality: "draft",
    status: "generating",
    createdByHqUserId: input.hqUserId,
    createdAt: now,
  });

  try {
    const provider = getImageGenerationProvider(input.modelProvider);
    const result = await provider.generateDraft({
      prompt: input.promptBody,
      modelType: input.modelType,
      portraitUrl: input.portraitUrl,
    });

    const [updated] = await db
      .update(schema.trainConductorGeneratedImages)
      .set({
        status: "completed",
        externalImageUrls: result.imageUrls,
        errorMessage: null,
      })
      .where(eq(schema.trainConductorGeneratedImages.id, imageId))
      .returning();

    if (!updated) {
      throw new Error("Failed to persist generated images.");
    }

    return mapGeneratedImageRow(updated, null);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed.";
    await db
      .update(schema.trainConductorGeneratedImages)
      .set({ status: "failed", errorMessage: message })
      .where(eq(schema.trainConductorGeneratedImages.id, imageId));
    throw error;
  }
}

export async function finalizeConductorDraftImage(input: {
  allianceId: string;
  conductorRecordId: string;
  imageId: string;
  selectedExternalUrl: string;
}): Promise<ConductorGeneratedImage> {
  const db = getDb();
  const [row] = await db
    .select({
      image: schema.trainConductorGeneratedImages,
      recordAllianceId: schema.trainConductorRecords.allianceId,
    })
    .from(schema.trainConductorGeneratedImages)
    .innerJoin(
      schema.trainConductorRecords,
      eq(
        schema.trainConductorGeneratedImages.conductorRecordId,
        schema.trainConductorRecords.id,
      ),
    )
    .where(
      and(
        eq(schema.trainConductorGeneratedImages.id, input.imageId),
        eq(schema.trainConductorGeneratedImages.conductorRecordId, input.conductorRecordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  if (!row?.image) {
    throw new Error("Generated image not found.");
  }

  const provider = getImageGenerationProvider(
    row.image.modelProvider as ImageModelProvider,
  );

  let sourceUrl = input.selectedExternalUrl;
  if (provider.upscaleSelected && row.image.modelProvider === "craiyon") {
    sourceUrl = await provider.upscaleSelected(sourceUrl);
  }

  const bytes = await fetchImageBytes(sourceUrl);
  const storageKey = conductorImageStorageKey({
    allianceId: input.allianceId,
    imageId: input.imageId,
  });
  await putObject(storageKey, bytes);

  const now = new Date();
  const [updated] = await db
    .update(schema.trainConductorGeneratedImages)
    .set({
      quality: "final",
      status: "completed",
      storageKey,
      selectedExternalUrl: input.selectedExternalUrl,
      finalizedAt: now,
      errorMessage: null,
    })
    .where(eq(schema.trainConductorGeneratedImages.id, input.imageId))
    .returning();

  if (!updated) {
    throw new Error("Failed to finalize image.");
  }

  const downloadUrl = await resolveDownloadUrl({
    conductorRecordId: input.conductorRecordId,
    imageId: input.imageId,
    storageKey,
  });

  return mapGeneratedImageRow(updated, downloadUrl);
}

export async function loadFinalizedConductorImageBytes(input: {
  allianceId: string;
  conductorRecordId: string;
  imageId: string;
}): Promise<{ bytes: Buffer; contentType: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      storageKey: schema.trainConductorGeneratedImages.storageKey,
      quality: schema.trainConductorGeneratedImages.quality,
    })
    .from(schema.trainConductorGeneratedImages)
    .innerJoin(
      schema.trainConductorRecords,
      eq(
        schema.trainConductorGeneratedImages.conductorRecordId,
        schema.trainConductorRecords.id,
      ),
    )
    .where(
      and(
        eq(schema.trainConductorGeneratedImages.id, input.imageId),
        eq(schema.trainConductorGeneratedImages.conductorRecordId, input.conductorRecordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
        eq(schema.trainConductorGeneratedImages.quality, "final"),
      ),
    )
    .limit(1);

  if (!row?.storageKey) return null;

  const { getObject } = await import("@/lib/storage");
  const bytes = await getObject(row.storageKey);
  return { bytes, contentType: "image/jpeg" };
}

export { prefersLocalStorage };
