/**
 * Client-safe in-game chat line parsers for officer intelligence OCR.
 *
 * Expects OCR text from the Alliance / R4 & R5 chat feed. Each message block
 * starts with a sender header (`[TAG]Name`, optional VIP / Lv badges) followed
 * by body lines. An optional in-game translation block appears below a dashed
 * separator when the player triggered translate in-game.
 */

import type { ParsedOfficerChatMessage } from "@/lib/officer-intel/types.shared";

const TRANSLATION_SEPARATOR = /^-{4,}$/;
const REPLY_PREFIX = /^Reply\s+([^:@]+?)\s*:\s*(.*)$/i;
const SENDER_TAG_NAME = /\[([^\]]+)\]\s*(\S+)/;
const VIP_LEVEL = /\bVIP\s*(\d+)\b/i;
const PLAYER_LEVEL = /\bLv\.?\s*(\d+)\b/i;

const NOISE_LINES = new Set(
  [
    "feedback",
    "world",
    "alliance",
    "moments",
    "private",
    "chat",
    "alliance announcement",
    "r4 & r5",
    "r4 and r5",
    "send a message",
  ].map((line) => line.toLowerCase()),
);

export function isOfficerChatNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return NOISE_LINES.has(trimmed.toLowerCase());
}

export function splitMessageBodyAndTranslation(lines: readonly string[]): {
  originalLines: string[];
  inGameTranslatedText: string | null;
} {
  const separatorIndex = lines.findIndex((line) =>
    TRANSLATION_SEPARATOR.test(line.trim()),
  );
  if (separatorIndex < 0) {
    return {
      originalLines: [...lines],
      inGameTranslatedText: null,
    };
  }

  const originalLines = lines.slice(0, separatorIndex);
  const translatedLines = lines
    .slice(separatorIndex + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^feedback$/i.test(line));

  const inGameTranslatedText =
    translatedLines.length > 0 ? translatedLines.join("\n") : null;

  return { originalLines, inGameTranslatedText };
}

export function parseSenderHeaderLine(line: string): {
  senderAllianceTag: string | null;
  senderName: string;
  senderLevel: number | null;
  senderVipLevel: number | null;
} | null {
  const trimmed = line.trim();
  if (!trimmed || isOfficerChatNoiseLine(trimmed)) return null;

  const tagMatch = trimmed.match(SENDER_TAG_NAME);
  if (!tagMatch) return null;

  const vipMatch = trimmed.match(VIP_LEVEL);
  const levelMatch = trimmed.match(PLAYER_LEVEL);

  return {
    senderAllianceTag: tagMatch[1]?.trim() || null,
    senderName: tagMatch[2]?.trim() || "Unknown",
    senderLevel: levelMatch ? Number.parseInt(levelMatch[1]!, 10) : null,
    senderVipLevel: vipMatch ? Number.parseInt(vipMatch[1]!, 10) : null,
  };
}

function parseBodyLine(line: string): {
  isReply: boolean;
  replyToName: string | null;
  text: string;
} {
  const replyMatch = line.trim().match(REPLY_PREFIX);
  if (!replyMatch) {
    return { isReply: false, replyToName: null, text: line.trim() };
  }
  return {
    isReply: true,
    replyToName: replyMatch[1]?.trim() || null,
    text: replyMatch[2]?.trim() ?? "",
  };
}

/**
 * Parse OCR lines from one chat screenshot into ordered message blocks.
 */
export function parseOfficerChatText(
  lines: readonly string[],
  sourceImageIndex = 0,
  sequenceOffset = 0,
): ParsedOfficerChatMessage[] {
  const messages: ParsedOfficerChatMessage[] = [];
  let currentHeader: ReturnType<typeof parseSenderHeaderLine> = null;
  let bodyLines: string[] = [];
  let sequenceOrder = sequenceOffset;

  const flush = () => {
    if (!currentHeader) return;
    const { originalLines, inGameTranslatedText } =
      splitMessageBodyAndTranslation(bodyLines);
    const joined = originalLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^feedback$/i.test(line))
      .join("\n")
      .trim();

    if (!joined) {
      currentHeader = null;
      bodyLines = [];
      return;
    }

    const firstLine = originalLines[0] ?? "";
    const replyMeta = parseBodyLine(firstLine);
    const originalText = replyMeta.isReply
      ? [replyMeta.text, ...originalLines.slice(1)]
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n")
          .trim()
      : joined;

    if (!originalText) {
      currentHeader = null;
      bodyLines = [];
      return;
    }

    messages.push({
      senderAllianceTag: currentHeader.senderAllianceTag,
      senderName: currentHeader.senderName,
      senderLevel: currentHeader.senderLevel,
      senderVipLevel: currentHeader.senderVipLevel,
      originalText,
      inGameTranslatedText,
      isReply: replyMeta.isReply,
      replyToName: replyMeta.replyToName,
      sequenceOrder,
      sourceImageIndex,
    });
    sequenceOrder += 1;
    currentHeader = null;
    bodyLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isOfficerChatNoiseLine(line)) continue;

    const header = parseSenderHeaderLine(line);
    if (header) {
      flush();
      currentHeader = header;
      bodyLines = [];
      continue;
    }

    if (!currentHeader) continue;
    bodyLines.push(line);
  }

  flush();
  return messages;
}

/** Merge messages from multiple screenshots, preserving scroll order. */
export function mergeOfficerChatParses(
  parts: readonly ParsedOfficerChatMessage[][],
): ParsedOfficerChatMessage[] {
  const merged: ParsedOfficerChatMessage[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    for (const message of part) {
      const key = [message.senderName, message.originalText].join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...message,
        sequenceOrder: merged.length,
      });
    }
  }

  return merged;
}
