import { z } from "zod";

import { historyCoordinatesSchema } from "@/lib/notes/imports.shared";

export const CHAT_PARSER_CONFIG_VERSION = "chat-video-v1";
export const CHAT_REPLY_LINK_THRESHOLD = 0.72;
export const CHAT_REPLY_UNCERTAIN_THRESHOLD = 0.88;

export type ChatBox = { x: number; y: number; width: number; height: number };
export type ParsedChatMedia = { kind: "embedded" | "fullscreen"; box: ChatBox; messageLocalId: string | null; confidence: number };
export type ParsedChatMessage = { localId: string; sender: string | null; originalText: string; detectedLanguage: string | null; confidence: number; box: ChatBox; isReply: boolean; replyToName: string | null; replyExcerpt: string | null; coordinates: { server: number | null; x: number; y: number; label: string | null } | null };
export type ParsedChatFrame = { frameIndex: number; timestampMs: number | null; frameHash: string; sharpness: number; messages: ParsedChatMessage[]; media: ParsedChatMedia[] };
export type StitchedChatMessage = ParsedChatMessage & { observationFrameIndex: number; timestampMs: number | null; frameHash: string; reviewReasons: string[]; replyToIndex: number | null; replyMatchConfidence: number | null };
export type StitchedChatMedia = ParsedChatMedia & { sourceFrameIndex: number; sourceTimestampMs: number | null; messageIndex: number | null };

const chatBoxSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1),
}).strict().refine(
  (box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001,
  { message: "box must stay inside the normalized frame" },
);

const nullableText = (max: number) => z.string().max(max).nullable();
export const parsedChatMessageSchema = z.object({
  localId: z.string().min(1).max(80),
  sender: nullableText(160),
  originalText: z.string().max(10_000),
  detectedLanguage: nullableText(24),
  confidence: z.number().finite().min(0).max(1),
  box: chatBoxSchema,
  isReply: z.boolean(),
  replyToName: nullableText(160),
  replyExcerpt: nullableText(160),
  coordinates: historyCoordinatesSchema.nullable(),
}).strict();
export const parsedChatMediaSchema = z.object({
  kind: z.enum(["embedded", "fullscreen"]),
  box: chatBoxSchema,
  messageLocalId: z.string().min(1).max(80).nullable(),
  confidence: z.number().finite().min(0).max(1),
}).strict();
export const parsedChatFrameOutputSchema = z.object({
  messages: z.array(parsedChatMessageSchema).max(100),
  media: z.array(parsedChatMediaSchema).max(30),
}).strict().superRefine((output, ctx) => {
  const localIds = new Set<string>();
  output.messages.forEach((message, index) => {
    if (localIds.has(message.localId)) {
      ctx.addIssue({ code: "custom", message: "duplicate localId", path: ["messages", index, "localId"] });
    }
    localIds.add(message.localId);
  });
  output.media.forEach((item, index) => {
    if (item.messageLocalId != null && !localIds.has(item.messageLocalId)) {
      ctx.addIssue({ code: "custom", message: "media references an unknown message", path: ["media", index, "messageLocalId"] });
    }
  });
});
export type ParsedChatFrameOutput = z.infer<typeof parsedChatFrameOutputSchema>;

const MATCH_TEXT_WEIGHT = 0.65;
const MATCH_SENDER_WEIGHT = 0.25;
const MATCH_REPLY_WEIGHT = 0.1;
const MATCH_THRESHOLD = 0.78;
const ALIGN_WINDOW = 30;

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function bigramDice(a: string, b: string): number {
  if (!a.length || !b.length) return a === b ? 1 : 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      grams.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function textSimilarity(a: string | null, b: string | null): number {
  return bigramDice(normalizeForMatch(a), normalizeForMatch(b));
}

function senderSimilarity(a: string | null, b: string | null): number {
  const an = normalizeForMatch(a);
  const bn = normalizeForMatch(b);
  if (!an.length || !bn.length) return an === bn ? 1 : 0.5;
  return bigramDice(an, bn);
}

function replySimilarity(a: ParsedChatMessage, b: ParsedChatMessage): number {
  const pairs: number[] = [];
  const nameA = normalizeForMatch(a.replyToName);
  const senderB = normalizeForMatch(b.sender);
  if (nameA.length && senderB.length) pairs.push(bigramDice(nameA, senderB));
  const excerptA = normalizeForMatch(a.replyExcerpt);
  const textB = normalizeForMatch(b.originalText);
  if (excerptA.length && textB.length) pairs.push(bigramDice(excerptA, textB));
  if (!pairs.length) return a.isReply === b.isReply ? 0.5 : 0;
  return Math.max(...pairs);
}

function messageMatchScore(candidate: ParsedChatMessage, incoming: ParsedChatMessage): number {
  return (
    MATCH_TEXT_WEIGHT * textSimilarity(candidate.originalText, incoming.originalText) +
    MATCH_SENDER_WEIGHT * senderSimilarity(candidate.sender, incoming.sender) +
    MATCH_REPLY_WEIGHT * replySimilarity(candidate, incoming)
  );
}

function observationScore(message: ParsedChatMessage, sharpness: number): number {
  const normalizedSharpness = Math.min(1, Math.max(0, sharpness));
  return message.confidence * 0.7 + normalizedSharpness * 0.3;
}

function reviewReasonsFor(message: StitchedChatMessage): string[] {
  const reasons = new Set(message.reviewReasons);
  if (message.confidence < 0.8) reasons.add("low_confidence");
  if (message.originalText.trim().length > 0 && !message.sender?.trim()) reasons.add("missing_sender");
  if (message.coordinates && message.confidence < 0.9) reasons.add("coordinate_uncertain");
  return [...reasons];
}

export function stitchChatFrames(frames: readonly ParsedChatFrame[]): {
  messages: StitchedChatMessage[];
  media: Array<StitchedChatMedia>;
} {
  const stitched: StitchedChatMessage[] = [];
  const sharpnessByMessage = new Map<StitchedChatMessage, number>();
  const canonicalByObsKey = new Map<string, StitchedChatMessage>();
  const appendNew = (parsed: ParsedChatMessage, frame: ParsedChatFrame, out: StitchedChatMessage[]) => {
    const message: StitchedChatMessage = {
      ...parsed,
      observationFrameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      frameHash: frame.frameHash,
      reviewReasons: [],
      replyToIndex: null,
      replyMatchConfidence: null,
    };
    out.push(message);
    sharpnessByMessage.set(message, frame.sharpness);
    canonicalByObsKey.set(`${frame.frameIndex}:${parsed.localId}`, message);
  };
  for (const frame of frames) {
    const windowStart = Math.max(0, stitched.length - ALIGN_WINDOW);
    const tail = stitched.slice(windowStart);
    const rows = frame.messages.length;
    const cols = tail.length;
    const scores = Array.from({ length: rows }, (_, i) =>
      tail.map((candidate) => messageMatchScore(candidate, frame.messages[i]!)),
    );
    const dp = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
    for (let i = 1; i <= rows; i++) {
      for (let j = 1; j <= cols; j++) {
        const match = scores[i - 1]![j - 1]! >= MATCH_THRESHOLD
          ? dp[i - 1]![j - 1]! + scores[i - 1]![j - 1]!
          : Number.NEGATIVE_INFINITY;
        dp[i]![j] = Math.max(match, dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
    const alignment: Array<number | null> = new Array(rows).fill(null);
    let i = rows;
    let j = cols;
    while (i > 0 && j > 0) {
      if (
        scores[i - 1]![j - 1]! >= MATCH_THRESHOLD &&
        dp[i]![j] === dp[i - 1]![j - 1]! + scores[i - 1]![j - 1]!
      ) {
        alignment[i - 1] = j - 1;
        i -= 1;
        j -= 1;
      } else if (dp[i]![j] === dp[i - 1]![j]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    const incomingForTail = new Map<number, number>();
    alignment.forEach((tailIndex, incomingIndex) => {
      if (tailIndex != null && !incomingForTail.has(tailIndex)) {
        incomingForTail.set(tailIndex, incomingIndex);
      }
    });

    if (incomingForTail.size === 0) {
      for (const parsed of frame.messages) appendNew(parsed, frame, stitched);
      continue;
    }

    const newTail: StitchedChatMessage[] = [];
    let incoming = 0;
    for (let tailIndex = 0; tailIndex < tail.length; tailIndex++) {
      const alignedIncoming = incomingForTail.get(tailIndex);
      const upto = alignedIncoming != null ? alignedIncoming : incoming;
      while (incoming < upto) {
        appendNew(frame.messages[incoming]!, frame, newTail);
        incoming += 1;
      }
      if (alignedIncoming != null) {
        const existing = tail[tailIndex]!;
        const parsed = frame.messages[alignedIncoming]!;
        if (
          observationScore(parsed, frame.sharpness) >
          observationScore(existing, sharpnessByMessage.get(existing) ?? 0)
        ) {
          Object.assign(existing, parsed, {
            observationFrameIndex: frame.frameIndex,
            timestampMs: frame.timestampMs,
            frameHash: frame.frameHash,
          });
          sharpnessByMessage.set(existing, frame.sharpness);
        }
        canonicalByObsKey.set(`${frame.frameIndex}:${parsed.localId}`, existing);
        incoming = alignedIncoming + 1;
      }
      newTail.push(tail[tailIndex]!);
    }
    while (incoming < frame.messages.length) {
      appendNew(frame.messages[incoming]!, frame, newTail);
      incoming += 1;
    }
    stitched.splice(windowStart, tail.length, ...newTail);
  }

  const indexByMessage = new Map<StitchedChatMessage, number>();
  stitched.forEach((message, index) => indexByMessage.set(message, index));

  const messages = stitched.map((message) => ({
    ...message,
    reviewReasons: reviewReasonsFor(message),
  }));

  const media: StitchedChatMedia[] = [];
  for (const frame of frames) {
    for (const candidate of frame.media) {
      const canonical =
        candidate.messageLocalId != null
          ? canonicalByObsKey.get(`${frame.frameIndex}:${candidate.messageLocalId}`)
          : undefined;
      media.push({
        ...candidate,
        sourceFrameIndex: frame.frameIndex,
        sourceTimestampMs: frame.timestampMs,
        messageIndex: canonical != null ? (indexByMessage.get(canonical) ?? null) : null,
      });
    }
  }

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (!message.isReply) continue;
    let bestIndex: number | null = null;
    let bestScore = 0;
    for (let candidate = 0; candidate < index; candidate++) {
      const score = replySimilarity(message, messages[candidate]!);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidate;
      }
    }
    if (bestIndex != null && bestScore >= CHAT_REPLY_LINK_THRESHOLD) {
      message.replyToIndex = bestIndex;
      message.replyMatchConfidence = bestScore;
      if (bestScore < CHAT_REPLY_UNCERTAIN_THRESHOLD) message.reviewReasons.push("reply_uncertain");
    } else {
      message.reviewReasons.push("reply_unresolved");
    }
  }

  for (const message of messages) {
    message.reviewReasons = reviewReasonsFor(message);
  }

  return { messages, media };
}
