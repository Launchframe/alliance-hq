import { z } from "zod";
import { redactIntakeText } from "./intake.shared";
import { MAX_OFFICER_INTEL_IMAGE_BYTES, MAX_OFFICER_INTEL_IMAGES } from "@/lib/officer-intel/storage.shared";

export const HISTORY_IMPORT_VERSION = 1;
export const HISTORY_IMPORT_PAGE_SIZE = 50;
export const HISTORY_IMPORT_KINDS = ["text", "markdown", "discord_json", "screenshots"] as const;
export const HISTORY_TEXT_BYTES = 5 * 1024 * 1024;
export const HISTORY_IMAGE_BYTES = MAX_OFFICER_INTEL_IMAGE_BYTES;
export const HISTORY_BATCH_BYTES = 60 * 1024 * 1024;
export const HISTORY_MESSAGE_LIMIT = 5_000;
export const HISTORY_MESSAGE_LENGTH = 10_000;
export type HistoryImportKind = typeof HISTORY_IMPORT_KINDS[number];
export type HistoryImportState = "uploading" | "queued" | "processing" | "review" | "committed" | "cancelled" | "failed";
export type HistoryJobState = "pending" | "running" | "completed" | "cancelled" | "failed";
export const historyInitSchema = z.object({
  expectedScope: z.string().min(1).max(300), requestId: z.string().min(8).max(120), title: z.string().trim().min(1).max(160), kind: z.enum(HISTORY_IMPORT_KINDS), locale: z.enum(["en-US", "pt-BR"]),
  files: z.array(z.object({ name: z.string().trim().min(1).max(160), contentType: z.enum(["text/plain", "text/markdown", "application/json", "image/png", "image/jpeg", "image/webp"]), size: z.number().int().positive().max(HISTORY_IMAGE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(MAX_OFFICER_INTEL_IMAGES),
}).refine((input) => input.files.reduce((sum, file) => sum + file.size, 0) <= HISTORY_BATCH_BYTES && (input.kind === "screenshots"
  ? input.files.every((file) => file.contentType.startsWith("image/"))
  : input.files.length === 1 && input.files[0].size <= HISTORY_TEXT_BYTES && input.files[0].contentType === ({ text: "text/plain", markdown: "text/markdown", discord_json: "application/json" } as const)[input.kind]));
export type HistoryInit = z.infer<typeof historyInitSchema>;
export type HistoryImportSummary = { scope: string; id: string; title: string; kind: HistoryImportKind; state: HistoryImportState; version: number; updatedAt: string; total: number; reviewed: number; cursor: number; attempts: number; errorCode: string | null; files: Array<{ id: string; name: string; contentType: string; size: number; sha256: string; sealed: boolean }> };
export type HistoryReviewRow = { id: string; sender: string | null; sentAt: string | null; body: string; included: boolean; reviewed: boolean; position: number };
export type HistoryImportDetail = HistoryImportSummary & { messages: HistoryReviewRow[]; offset: number };
export type HistoryImportListItem = Pick<HistoryImportSummary, "id" | "title" | "state" | "kind" | "updatedAt">;
export type HistoryImportPage = { scope: string; imports: HistoryImportListItem[]; nextCursor: string | null; previousCursor: string | null };

const identity = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
export { identity as historyImportIdentitySchema };
const historyListCursorSchema = z.object({ version: z.literal(1), scope: z.string().min(1).max(300), id: identity, updatedAt: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")), direction: z.enum(["next", "previous"]).optional() }).strict();
export type HistoryListCursor = z.infer<typeof historyListCursorSchema>;
export function parseHistoryListCursor(raw: string | null): HistoryListCursor | null {
  return raw === null ? null : historyListCursorSchema.parse(JSON.parse(z.string().min(1).max(700).parse(raw)));
}
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
