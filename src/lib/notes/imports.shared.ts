import { z } from "zod";
import { redactIntakeText } from "./intake.shared";
import { MAX_OFFICER_INTEL_IMAGE_BYTES, MAX_OFFICER_INTEL_IMAGES } from "@/lib/officer-intel/storage.shared";

export const HISTORY_IMPORT_VERSION = 1;
export const HISTORY_IMPORT_KINDS = ["text", "markdown", "discord_json", "screenshots"] as const;
export const HISTORY_TEXT_BYTES = 5 * 1024 * 1024;
export const HISTORY_IMAGE_BYTES = MAX_OFFICER_INTEL_IMAGE_BYTES;
export const HISTORY_BATCH_BYTES = 60 * 1024 * 1024;
export const HISTORY_MESSAGE_LIMIT = 5_000;
export const HISTORY_MESSAGE_LENGTH = 10_000;
export type HistoryImportKind = typeof HISTORY_IMPORT_KINDS[number];

const identity = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const body = z.string().max(HISTORY_MESSAGE_LENGTH).refine((value) => !value.includes("\0"));
const timestamp = z.iso.datetime({ offset: true }).nullable();
export const historyMessageSchema = z.object({
  locator: z.string().min(1).max(300), externalId: identity.nullable(),
  sender: z.string().trim().max(160).nullable(), sentAt: timestamp, body,
  sourceImageIndex: z.number().int().min(0).max(MAX_OFFICER_INTEL_IMAGES - 1).nullable(),
});
export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export const historyReviewSchema = historyMessageSchema.pick({ sender: true, sentAt: true, body: true }).extend({
  included: z.boolean(), expectedVersion: z.number().int().positive(),
});
const exportMessage = z.object({ id: identity, timestamp, author: z.object({ name: z.string().max(160) }).nullable(), content: body });
const versionedExport = z.object({ schemaVersion: z.literal(HISTORY_IMPORT_VERSION), messages: z.array(exportMessage).min(1).max(HISTORY_MESSAGE_LIMIT) });
const discordExport = z.object({ guild: z.object({ id: identity }), channel: z.object({ id: identity }), messages: z.array(exportMessage).min(1).max(HISTORY_MESSAGE_LIMIT) });

export function redactHistoryMessage(message: HistoryMessage): HistoryMessage {
  return historyMessageSchema.parse({ ...message, sender: message.sender?.trim() ? redactIntakeText(message.sender.trim()) : null, body: redactIntakeText(message.body) });
}

export function parseHistoryText(kind: Exclude<HistoryImportKind, "screenshots">, text: string, assetId: string): HistoryMessage[] {
  identity.parse(assetId);
  if (!text.trim() || text.includes("\0") || new TextEncoder().encode(text).byteLength > HISTORY_TEXT_BYTES) throw new Error("invalid_import");
  if (kind === "discord_json") {
    const input: unknown = JSON.parse(text);
    const parsed = input && typeof input === "object" && "schemaVersion" in input ? versionedExport.parse(input) : discordExport.parse(input);
    const seen = new Map<string, string>();
    const messages: HistoryMessage[] = [];
    for (const message of parsed.messages) {
      const fingerprint = JSON.stringify(message);
      const previous = seen.get(message.id);
      if (previous !== undefined && previous !== fingerprint) throw new Error("conflicting_message_id");
      if (previous !== undefined) continue;
      seen.set(message.id, fingerprint);
      messages.push(redactHistoryMessage({ locator: `${assetId}:message:${message.id}`, externalId: message.id, sender: message.author?.name ?? null, sentAt: message.timestamp, body: message.content, sourceImageIndex: null }));
    }
    return messages;
  }
  if (kind !== "text" && kind !== "markdown") throw new Error("unsupported_import");
  const messages: HistoryMessage[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + HISTORY_MESSAGE_LENGTH, text.length);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf("\n", end - 1);
      if (lineBreak > start) end = lineBreak + 1;
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    messages.push(redactHistoryMessage({ locator: `${assetId}:chars:${start}-${end}`, externalId: null, sender: null, sentAt: null, body: text.slice(start, end), sourceImageIndex: null }));
    if (messages.length > HISTORY_MESSAGE_LIMIT) throw new Error("import_limit");
    start = end;
  }
  return messages;
}
