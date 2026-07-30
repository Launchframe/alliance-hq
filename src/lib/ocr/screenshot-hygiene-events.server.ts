import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { ScreenshotOcrQualityMetrics } from "@/lib/ocr/screenshot-ocr-quality.shared";

export type ScreenshotHygieneEventType =
  | "screenshot_parse_complete"
  | "screenshot_user_confirmed"
  | "screenshot_user_rejected"
  | "screenshot_crop_adapt_applied";

export type EmitScreenshotHygieneEventInput = {
  eventType: ScreenshotHygieneEventType;
  source: string;
  screenshotOcrJobId?: string | null;
  allianceId?: string | null;
  hqUserId?: string | null;
  discordUserId?: string | null;
  payload?: Record<string, unknown>;
};

export async function emitScreenshotHygieneEvent(
  input: EmitScreenshotHygieneEventInput,
): Promise<void> {
  const db = getDb();
  await db.insert(schema.screenshotHygieneEvents).values({
    id: nanoid(16),
    eventType: input.eventType,
    source: input.source,
    screenshotOcrJobId: input.screenshotOcrJobId ?? null,
    allianceId: input.allianceId ?? null,
    hqUserId: input.hqUserId ?? null,
    discordUserId: input.discordUserId ?? null,
    payloadJson: input.payload ?? null,
    createdAt: new Date(),
  });
}

export async function emitScreenshotParseCompleteEvent(input: {
  jobId: string;
  source: string;
  allianceId?: string | null;
  hqUserId?: string | null;
  discordUserId?: string | null;
  quality: ScreenshotOcrQualityMetrics;
}): Promise<void> {
  await emitScreenshotHygieneEvent({
    eventType: "screenshot_parse_complete",
    source: input.source,
    screenshotOcrJobId: input.jobId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    discordUserId: input.discordUserId,
    payload: {
      quality: input.quality,
      failureCodes: input.quality.failureCodes,
      pairedCount: input.quality.pairedCount,
      parsedOk: input.quality.parsedOk,
    },
  });
}
