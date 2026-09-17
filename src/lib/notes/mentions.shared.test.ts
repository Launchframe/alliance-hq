import { describe, expect, it } from "vitest";
import { detectNoteMentions } from "./mentions.shared";

const roster = [
  { ashedMemberId: "cookie", name: "Cookie", previousNames: ["Biscuit"] },
  { ashedMemberId: "ferg", name: "Ferg" },
  { ashedMemberId: "joao", name: "João" },
];

describe("conversational note member mentions", () => {
  it("links unique names and known aliases without a separate member prompt", () => {
    expect(detectNoteMentions("Cookie and Ferg are handling coverage. Biscuit already checked.", roster).memberIds).toEqual(["cookie", "ferg"]);
  });
  it("preserves ambiguity instead of letting a name map overwrite an earlier member", () => {
    const result = detectNoteMentions("Cookie needs help", [...roster, { ashedMemberId: "other", name: "Other", previousNames: ["Cookie"] }]);
    expect(result.memberIds).toEqual([]);
    expect(result.matches[0].candidates.map((member) => member.ashedMemberId)).toEqual(["cookie", "other"]);
  });
  it("respects word boundaries and does not infer members from URLs or code", () => {
    expect(detectNoteMentions("Cookiejar, https://example.test/Cookie and `Ferg`", roster).memberIds).toEqual([]);
  });
  it("handles composed names while preserving original source spans", () => {
    const text = "Falei com Joa\u0303o sobre a equipe.";
    const result = detectNoteMentions(text, roster);
    expect(result.memberIds).toEqual(["joao"]);
    expect(text.slice(result.matches[0].start, result.matches[0].end)).toBe("Joa\u0303o");
  });
  it("requires clarification for common words unless they are explicitly mentioned", () => {
    const members = [{ ashedMemberId: "will", name: "Will" }];
    expect(detectNoteMentions("Will we do this today?", members).memberIds).toEqual([]);
    expect(detectNoteMentions("Ask @Will about it", members).memberIds).toEqual(["will"]);
  });
  it("prefers a full name over an overlapping shorter name", () => {
    expect(detectNoteMentions("Cookie Monster is ready", [...roster, { ashedMemberId: "monster", name: "Cookie Monster" }]).memberIds).toEqual(["monster"]);
  });
});
