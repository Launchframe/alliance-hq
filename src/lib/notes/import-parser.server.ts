import "server-only";

import { isOfficerChatNoiseLine, parseSenderHeaderLine } from "@/lib/officer-intel/chat-ocr/parse-chat-text.shared";
import { redactIntakeText } from "./intake.shared";
import { HISTORY_MESSAGE_LIMIT, HISTORY_TEXT_BYTES, historyImportIdentitySchema, historyMessageSchema, parseHistoryText, redactHistoryMessage, type HistoryMessage } from "./imports.shared";

export function parseHistoryScreenshot(parsed: { messages: ReadonlyArray<{ senderName: string; originalText: string }>; rawLines: readonly string[] }, assetId: string, sourceImageIndex: number): HistoryMessage[] {
  historyImportIdentitySchema.parse(assetId);
  const firstHeader = parsed.rawLines.findIndex((line) => parseSenderHeaderLine(line) !== null);
  const orphanLines = parsed.messages.length ? parsed.rawLines.slice(0, Math.max(0, firstHeader)) : parsed.rawLines;
  const text = orphanLines.filter((line) => !isOfficerChatNoiseLine(line)).join("\n");
  if (text.includes("\0") || new TextEncoder().encode(text).byteLength > HISTORY_TEXT_BYTES) throw new Error("invalid_import");
  const orphans = text.trim() ? parseHistoryText("text", redactIntakeText(text), assetId).map((row, index) => historyMessageSchema.parse({ ...row, sourceImageIndex, locator: `${assetId}:ocr:${parsed.messages.length ? `unattributed:${index}` : index}` })) : [];
  if (orphans.length + parsed.messages.length > HISTORY_MESSAGE_LIMIT) throw new Error("import_limit");
  return [...orphans, ...parsed.messages.map((row, index) => redactHistoryMessage({ sender: row.senderName || null, body: row.originalText, sentAt: null, externalId: null, sourceImageIndex, locator: `${assetId}:ocr:${index}` }))];
}
