import { expect, it } from "vitest";
import { validateGenerationPart } from "./generation.shared";

const sources = [{ id: "evidence-one", text: "A verified source quote" }];
it("requires exact current evidence for every generated section and action", () => {
  const result = { title: "Reviewed result", sections: [{ text: "A finding", citations: [{ id: "evidence-one", quote: "verified source" }] }], actions: [] };
  expect(validateGenerationPart(result, sources, "synthesize")).toBe(true);
  expect(validateGenerationPart({ ...result, sections: [{ text: "Claim", citations: [{ id: "unknown", quote: "verified source" }] }] }, sources, "ask")).toBe(false);
  expect(validateGenerationPart({ ...result, sections: [{ text: "Claim", citations: [{ id: "evidence-one", quote: "not present" }] }] }, sources, "ask")).toBe(false);
});
it("requires localization to cover every input chunk and rejects binding-data output", () => {
  const result = { title: "Result", sections: [{ text: "Localized text", citations: [{ id: "evidence-one", quote: "source quote" }] }], actions: [] };
  expect(validateGenerationPart(result, [...sources, { id: "evidence-two", text: "Another source" }], "localize")).toBe(false);
  expect(validateGenerationPart({ ...result, title: "1".repeat(14) }, sources, "synthesize")).toBe(false);
});
