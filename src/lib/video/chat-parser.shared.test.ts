import { describe, expect, it } from "vitest";

import {
  CHAT_REPLY_LINK_THRESHOLD,
  CHAT_REPLY_UNCERTAIN_THRESHOLD,
  parsedChatFrameOutputSchema,
  stitchChatFrames,
  type ParsedChatFrame,
  type ParsedChatMessage,
} from "./chat-parser.shared";

const box = { x: 0.05, y: 0.1, width: 0.8, height: 0.08 };

function message(overrides: Partial<ParsedChatMessage> = {}): ParsedChatMessage {
  return {
    localId: "m0",
    sender: "Officer",
    originalText: "hello there",
    detectedLanguage: "en",
    confidence: 0.95,
    box,
    isReply: false,
    replyToName: null,
    replyExcerpt: null,
    coordinates: null,
    ...overrides,
  };
}

function frame(index: number, messages: ParsedChatMessage[], overrides: Partial<ParsedChatFrame> = {}): ParsedChatFrame {
  return {
    frameIndex: index,
    timestampMs: index * 1000,
    frameHash: `hash-${index}`,
    sharpness: 0.5,
    messages,
    media: [],
    ...overrides,
  };
}

describe("parsedChatFrameOutputSchema", () => {
  const valid = { messages: [message()], media: [] };

  it("accepts a valid frame output", () => {
    expect(parsedChatFrameOutputSchema.parse(valid).messages).toHaveLength(1);
  });

  it("rejects boxes outside normalized bounds", () => {
    const bad = { messages: [message({ box: { x: 0.8, y: 0.1, width: 0.5, height: 0.08 } })], media: [] };
    expect(() => parsedChatFrameOutputSchema.parse(bad)).toThrow();
    const negative = { messages: [message({ box: { x: -0.1, y: 0.1, width: 0.5, height: 0.08 } })], media: [] };
    expect(() => parsedChatFrameOutputSchema.parse(negative)).toThrow();
    const nonFinite = { messages: [message({ box: { x: 0, y: 0, width: Number.NaN, height: 0.5 } })], media: [] };
    expect(() => parsedChatFrameOutputSchema.parse(nonFinite)).toThrow();
  });

  it("rejects out-of-range confidence and oversized text", () => {
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: [message({ confidence: 1.2 })], media: [] }),
    ).toThrow();
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: [message({ originalText: "x".repeat(10_001) })], media: [] }),
    ).toThrow();
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: [message({ sender: "s".repeat(161) })], media: [] }),
    ).toThrow();
  });

  it("rejects oversized message/media arrays", () => {
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: Array.from({ length: 101 }, () => message()), media: [] }),
    ).toThrow();
    expect(() =>
      parsedChatFrameOutputSchema.parse({
        messages: [],
        media: Array.from({ length: 31 }, () => ({
          kind: "embedded", box, messageLocalId: null, confidence: 0.5,
        })),
      }),
    ).toThrow();
  });

  it("rejects duplicate message localIds and dangling media references", () => {
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: [message(), message()], media: [] }),
    ).toThrow();
    expect(() =>
      parsedChatFrameOutputSchema.parse({
        messages: [message()],
        media: [{ kind: "embedded", box, messageLocalId: "missing", confidence: 0.5 }],
      }),
    ).toThrow();
    // A linked media item naming a real localId is accepted.
    expect(
      parsedChatFrameOutputSchema.parse({
        messages: [message()],
        media: [{ kind: "embedded", box, messageLocalId: "m0", confidence: 0.5 }],
      }).media,
    ).toHaveLength(1);
  });

  it("rejects unknown keys and invalid coordinates", () => {
    expect(() =>
      parsedChatFrameOutputSchema.parse({ messages: [{ ...message(), extra: 1 }], media: [] }),
    ).toThrow();
    expect(() =>
      parsedChatFrameOutputSchema.parse({
        messages: [message({ coordinates: { server: -5, x: 1, y: 2, label: null } })],
        media: [],
      }),
    ).toThrow();
  });
});

describe("stitchChatFrames", () => {
  it("aligns a scrolled overlap so shared messages are not duplicated", () => {
    const a = message({ localId: "a", originalText: "first line" });
    const b = message({ localId: "b", originalText: "second line" });
    const c = message({ localId: "c", originalText: "third line" });
    const result = stitchChatFrames([
      frame(0, [a, b]),
      frame(1, [{ ...b, localId: "b2" }, c]),
    ]);
    expect(result.messages.map((m) => m.originalText)).toEqual([
      "first line",
      "second line",
      "third line",
    ]);
  });

  it("matches fuzzy OCR duplicates and retains the better observation", () => {
    const sharp = message({ localId: "a", originalText: "attack at noon", confidence: 0.6 });
    const blurry = message({ localId: "b", originalText: "attack at no0n", confidence: 0.95 });
    const result = stitchChatFrames([
      frame(0, [sharp], { sharpness: 0.9 }),
      frame(1, [blurry], { sharpness: 0.1 }),
    ]);
    expect(result.messages).toHaveLength(1);
    // confidence*0.7 + sharpness*0.3: 0.6*0.7+0.9*0.3=0.69 vs 0.95*0.7+0.1*0.3=0.695
    expect(result.messages[0]!.originalText).toBe("attack at no0n");
    expect(result.messages[0]!.observationFrameIndex).toBe(1);
  });

  it("normalizes unicode case and whitespace when matching", () => {
    const a = message({ localId: "a", originalText: "STRAße  now" });
    const b = message({ localId: "b", originalText: "straße   now" });
    const result = stitchChatFrames([frame(0, [a]), frame(1, [b])]);
    expect(result.messages).toHaveLength(1);
  });

  it("does not collapse identical repeated messages inside one frame", () => {
    const a = message({ localId: "a", originalText: "same text" });
    const b = message({ localId: "b", originalText: "same text" });
    const result = stitchChatFrames([frame(0, [a, b]), frame(1, [{ ...a, localId: "a2" }, { ...b, localId: "b2" }])]);
    expect(result.messages).toHaveLength(2);
  });

  it("inserts unmatched messages while preserving global order", () => {
    const a = message({ localId: "a", originalText: "anchor top" });
    const b = message({ localId: "b", originalText: "anchor bottom" });
    const mid = message({ localId: "x", originalText: "newly revealed" });
    const result = stitchChatFrames([
      frame(0, [a, b]),
      frame(1, [{ ...a, localId: "a2" }, mid, { ...b, localId: "b2" }]),
    ]);
    expect(result.messages.map((m) => m.originalText)).toEqual([
      "anchor top",
      "newly revealed",
      "anchor bottom",
    ]);
  });

  it("links replies only to earlier messages and flags unresolved replies", () => {
    const earlier = message({ localId: "a", sender: "Rhea", originalText: "meet at the gate" });
    const reply = message({
      localId: "r",
      isReply: true,
      replyToName: "Rhea",
      replyExcerpt: "meet at the gate",
    });
    const future = message({ localId: "f", sender: "Rhea", originalText: "meet at the gate", });
    const result = stitchChatFrames([
      frame(0, [reply]),
      frame(1, [earlier, future]),
    ]);
    // The reply is first in order, so the later sender/text cannot satisfy it.
    expect(result.messages[0]!.replyToIndex).toBeNull();
    expect(result.messages[0]!.reviewReasons).toContain("reply_unresolved");
  });

  it("links a reply to an earlier message above the link threshold", () => {
    const earlier = message({ localId: "a", sender: "Rhea", originalText: "meet at the gate" });
    const reply = message({
      localId: "r",
      isReply: true,
      replyToName: "Rhea",
      replyExcerpt: "meet at the gate",
      originalText: "on my way",
    });
    const result = stitchChatFrames([frame(0, [earlier, reply])]);
    expect(result.messages[1]!.replyToIndex).toBe(0);
    expect(result.messages[1]!.replyMatchConfidence).toBeGreaterThanOrEqual(CHAT_REPLY_LINK_THRESHOLD);
    expect(result.messages[1]!.reviewReasons).not.toContain("reply_unresolved");
  });

  it("flags reply_uncertain between the link and uncertain thresholds", () => {
    const earlier = message({ localId: "a", sender: "Rhea", originalText: "totally unrelated words here" });
    // Only the name matches (score = bigram similarity via name vs sender = 1.0 * 1.0 = max pair);
    // use a partial name match to land between 0.72 and 0.88.
    const reply = message({
      localId: "r",
      isReply: true,
      replyToName: "Rhe",
      replyExcerpt: null,
      originalText: "ok",
    });
    const result = stitchChatFrames([frame(0, [earlier, reply])]);
    const stitched = result.messages[1]!;
    expect(stitched.replyToIndex).toBe(0);
    expect(stitched.replyMatchConfidence).toBeLessThan(CHAT_REPLY_UNCERTAIN_THRESHOLD);
    expect(stitched.reviewReasons).toContain("reply_uncertain");
  });

  it("adds low_confidence, missing_sender, and coordinate_uncertain reasons", () => {
    const low = message({ localId: "a", confidence: 0.5 });
    const noSender = message({ localId: "b", sender: null, originalText: "anon text" });
    const coord = message({
      localId: "c",
      confidence: 0.85,
      coordinates: { server: 1, x: 100, y: 200, label: null },
    });
    const result = stitchChatFrames([frame(0, [low, noSender, coord])]);
    expect(result.messages[0]!.reviewReasons).toContain("low_confidence");
    expect(result.messages[1]!.reviewReasons).toContain("missing_sender");
    expect(result.messages[2]!.reviewReasons).toContain("coordinate_uncertain");
  });

  it("returns every media observation in source order with resolved messageIndex", () => {
    const a = message({ localId: "a" });
    const first = { kind: "embedded" as const, box: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, messageLocalId: "a", confidence: 0.9 };
    const second = { kind: "embedded" as const, box: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, messageLocalId: "b", confidence: 0.8 };
    const result = stitchChatFrames([
      frame(0, [a], { media: [first] }),
      // Aligned duplicate under a different localId still links the media to message 0.
      frame(1, [{ ...a, localId: "b" }], { media: [second] }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.media).toHaveLength(2);
    expect(result.media.map((m) => m.sourceFrameIndex)).toEqual([0, 1]);
    expect(result.media.map((m) => m.messageIndex)).toEqual([0, 0]);
  });

  it("resolves media linkage to the retained canonical message regardless of which observation won", () => {
    const a = message({ localId: "a", originalText: "attack at noon", confidence: 0.6 });
    const dup = message({ localId: "z", originalText: "attack at no0n", confidence: 0.95 });
    const mediaA = { kind: "embedded" as const, box, messageLocalId: "a", confidence: 0.9 };
    const mediaB = { kind: "embedded" as const, box, messageLocalId: "z", confidence: 0.9 };
    const result = stitchChatFrames([
      // The better-scoring observation is in frame 2, but frame 1's media still links.
      frame(0, [a], { sharpness: 0.1, media: [mediaA] }),
      frame(1, [dup], { sharpness: 0.9, media: [mediaB] }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.observationFrameIndex).toBe(1);
    expect(result.media.map((m) => m.messageIndex)).toEqual([0, 0]);
    expect(result.media[0]!.messageLocalId).toBe("a");
    expect(result.media[1]!.messageLocalId).toBe("z");
  });

  it("never drops media observations by geometry: identical boxes at adjacent timestamps both survive", () => {
    const box_ = { x: 0, y: 0, width: 1, height: 1 };
    const a = { kind: "fullscreen" as const, box: box_, messageLocalId: null, confidence: 0.9 };
    const b = { kind: "fullscreen" as const, box: box_, messageLocalId: null, confidence: 0.9 };
    const result = stitchChatFrames([
      frame(0, [], { media: [a] }),
      frame(1, [], { media: [b] }),
    ]);
    expect(result.media).toHaveLength(2);
    expect(result.media.map((m) => m.messageIndex)).toEqual([null, null]);
  });
});
