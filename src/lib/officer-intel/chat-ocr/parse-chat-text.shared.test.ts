import { describe, expect, it } from "vitest";

import {
  mergeOfficerChatParses,
  parseOfficerChatText,
  splitMessageBodyAndTranslation,
} from "@/lib/officer-intel/chat-ocr/parse-chat-text.shared";

describe("splitMessageBodyAndTranslation", () => {
  it("splits original and in-game translation at dashed separator", () => {
    const result = splitMessageBodyAndTranslation([
      "Não dá para impedir o banco.",
      "------------------------------",
      "You can't stop them from taking the bench.",
      "Feedback",
    ]);
    expect(result.originalLines).toEqual(["Não dá para impedir o banco."]);
    expect(result.inGameTranslatedText).toBe(
      "You can't stop them from taking the bench.",
    );
  });

  it("returns null translation when no separator", () => {
    const result = splitMessageBodyAndTranslation(["Groups setup and ready."]);
    expect(result.inGameTranslatedText).toBeNull();
  });
});

describe("parseOfficerChatText", () => {
  it("parses sender header, body, and translation block", () => {
    const messages = parseOfficerChatText([
      "R4 & R5",
      "VIP 14 Lv.35 [LFgo]CAIPIRA",
      "Não dá para impedir o banco.",
      "------------------------------",
      "You can't stop them from taking the bench.",
      "VIP 15 Lv.35 [LFgo]Freddy",
      "Reply orbsorbsorbs: @orbsorbsorbs if you get confirmation.",
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      senderAllianceTag: "LFgo",
      senderName: "CAIPIRA",
      senderLevel: 35,
      senderVipLevel: 14,
      originalText: "Não dá para impedir o banco.",
      inGameTranslatedText: "You can't stop them from taking the bench.",
      isReply: false,
    });
    expect(messages[1]).toMatchObject({
      senderName: "Freddy",
      senderVipLevel: 15,
      isReply: true,
      replyToName: "orbsorbsorbs",
      originalText: "@orbsorbsorbs if you get confirmation.",
    });
  });

  it("merges multi-image parses without duplicate blocks", () => {
    const partA = parseOfficerChatText(
      ["[LFgo]Alpha", "First message"],
      0,
      0,
    );
    const partB = parseOfficerChatText(
      ["[LFgo]Alpha", "First message", "[LFgo]Beta", "Second message"],
      1,
      0,
    );
    const merged = mergeOfficerChatParses([partA, partB]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.senderName)).toEqual(["Alpha", "Beta"]);
    expect(merged[0]?.sequenceOrder).toBe(0);
    expect(merged[1]?.sequenceOrder).toBe(1);
  });

  it("preserves repeated messages outside an adjacent screenshot overlap", () => {
    const partA = parseOfficerChatText(
      [
        "[LFgo]Alpha",
        "Same message",
        "[LFgo]Beta",
        "Middle message",
        "[LFgo]Alpha",
        "Same message",
      ],
      0,
      0,
    );
    const partB = parseOfficerChatText(
      ["[LFgo]Gamma", "Later message"],
      1,
      0,
    );

    const merged = mergeOfficerChatParses([partA, partB]);

    expect(merged.map((message) => message.senderName)).toEqual([
      "Alpha",
      "Beta",
      "Alpha",
      "Gamma",
    ]);
    expect(merged.map((message) => message.sequenceOrder)).toEqual([0, 1, 2, 3]);
  });
});
