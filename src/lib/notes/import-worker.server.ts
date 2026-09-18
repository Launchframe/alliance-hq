import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { claimHistoryJob, completeHistoryStep, failHistoryStep } from "./jobs.server";
import { parseHistoryText, type HistoryMessage } from "./imports.shared";
import { parseHistoryScreenshot } from "./import-parser.server";
import { readHistoryObject } from "./import-storage.server";

export async function processHistoryStep(importId?: string) {
  const lease = await claimHistoryJob(importId);
  if (!lease) return { processed: false };
  try {
    const testProvider = process.env.E2E_TEST === "true" && process.env.NOTES_HISTORY_TEST_PROVIDER === "true" && !process.env.VERCEL;
    if (testProvider) await new Promise((resolve) => setTimeout(resolve, 750));
    const [record] = await getDb().select().from(schema.knowledgeHistoryImports).where(and(eq(schema.knowledgeHistoryImports.id, lease.importId), eq(schema.knowledgeHistoryImports.allianceId, lease.allianceId)));
    const files = await getDb().select().from(schema.knowledgeHistoryAssets).where(and(eq(schema.knowledgeHistoryAssets.importId, lease.importId), eq(schema.knowledgeHistoryAssets.allianceId, lease.allianceId))).orderBy(schema.knowledgeHistoryAssets.position);
    const file = files[lease.cursor];
    let messages: HistoryMessage[] = [];
    if (file) {
      if (!file.sealedKey) throw new Error("unsealed_import");
      const bytes = await readHistoryObject(file.sealedKey, file.size, file.contentType, file.sha256);
      if (record.kind === "screenshots" && testProvider && bytes.equals(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8n8AAAAASUVORK5CYII=", "base64"))) {
        messages = [{ sender: null, sentAt: null, body: `Reviewed screenshot ${file.position + 1}`, externalId: null, sourceImageIndex: file.position, locator: `${file.id}:ocr:0` }];
      } else if (record.kind === "screenshots") {
        const sharp = (await import("sharp")).default;
        const image = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
        if (!image.width || !image.height || (image.pages ?? 1) !== 1) throw new Error("invalid_image");
        const { parseOfficerChatImage } = await import("@/lib/officer-intel/chat-ocr/parse-chat-image.server");
        const parsed = await parseOfficerChatImage(bytes, file.position);
        messages = parseHistoryScreenshot(parsed, file.id, file.position);
      } else messages = parseHistoryText(record.kind, new TextDecoder("utf-8", { fatal: true }).decode(bytes), file.id);
      if (!messages.length) throw new Error("empty_import");
    }
    return { processed: await completeHistoryStep(lease, messages, files.length) };
  } catch {
    await failHistoryStep(lease);
    return { processed: false };
  }
}
