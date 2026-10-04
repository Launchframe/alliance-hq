import "server-only";

import { mergeOfficerChatParses, parseOfficerChatText } from "@/lib/officer-intel/chat-ocr/parse-chat-text.shared";
import { preprocessOfficerChatImage } from "@/lib/officer-intel/chat-ocr/preprocess-chat-image.server";
import type { ParsedOfficerChatMessage } from "@/lib/officer-intel/types.shared";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";

export const OFFICER_CHAT_OCR_SCORE_TARGET = "officer-chat" as const;

const OFFICER_CHAT_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  tesseractPsm: 6,
  minWordConfidence: 0,
};

export type ParseOfficerChatImageResult = {
  messages: ParsedOfficerChatMessage[];
  rawLines: string[];
  width: number;
  height: number;
  durationMs: number;
};

export async function parseOfficerChatImage(
  imageBuffer: Buffer,
  sourceImageIndex = 0,
  sequenceOffset = 0,
): Promise<ParseOfficerChatImageResult> {
  const t0 = Date.now();
  const preprocessed = await preprocessOfficerChatImage(imageBuffer);
  const ocrLines = await runTesseract(preprocessed.buffer, OFFICER_CHAT_OCR_CONFIG);
  const rawLines = ocrLines.map((line) => line.text);
  const messages = parseOfficerChatText(
    rawLines,
    sourceImageIndex,
    sequenceOffset,
  );

  return {
    messages,
    rawLines,
    width: preprocessed.width,
    height: preprocessed.height,
    durationMs: Date.now() - t0,
  };
}

export function mergeOfficerChatImageParses(
  parts: readonly ParseOfficerChatImageResult[],
): { messages: ParsedOfficerChatMessage[]; rawLinesByImage: string[][] } {
  const messageParts = parts.map((part) => part.messages);
  return {
    messages: mergeOfficerChatParses(messageParts),
    rawLinesByImage: parts.map((part) => part.rawLines),
  };
}
