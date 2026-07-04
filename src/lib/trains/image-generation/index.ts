import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { CraiyonImageProvider } from "@/lib/trains/image-generation/craiyon";
import { FalImageProvider } from "@/lib/trains/image-generation/fal";
import type { ImageGenerationProvider } from "@/lib/trains/image-generation/provider";
import type { ImageModelProvider } from "@/lib/trains/prompt-templates.shared";

const providers: Record<ImageModelProvider, ImageGenerationProvider> = {
  craiyon: new CraiyonImageProvider(),
  fal: new FalImageProvider(),
};

export function getImageGenerationProvider(
  provider: ImageModelProvider,
): ImageGenerationProvider {
  return providers[provider];
}

export function defaultImageModelProvider(): ImageModelProvider {
  const fromEnv = process.env.IMAGE_GENERATION_DEFAULT_PROVIDER?.trim();
  if (fromEnv === "fal" || fromEnv === "craiyon") {
    return fromEnv;
  }
  return "craiyon";
}

export async function resolvePreferredImageProviderForUser(
  hqUserId: string | null,
): Promise<ImageModelProvider> {
  if (!hqUserId) return defaultImageModelProvider();

  const db = getDb();
  const [user] = await db
    .select({ preferredImageModel: schema.hqUsers.preferredImageModel })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  const preferred = user?.preferredImageModel?.trim();
  if (preferred === "fal" || preferred === "craiyon") {
    return preferred;
  }
  return defaultImageModelProvider();
}
