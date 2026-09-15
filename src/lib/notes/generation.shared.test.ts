import { expect, it } from "vitest";
import { generationCandidateAvailable, validateGenerationPart } from "./generation.shared";

const sources = [{ id: "evidence-one", text: "A verified source quote" }];
it("rechecks queue revision, backoff and lease expiry before claiming or cancelling", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const candidate = { version: 4, state: "pending", availableAt: new Date(now.getTime() - 1), leaseExpiresAt: null };
  expect(generationCandidateAvailable(candidate, 4, now)).toBe(true);
  expect(generationCandidateAvailable(candidate, 3, now)).toBe(false);
  expect(generationCandidateAvailable({ ...candidate, availableAt: new Date(now.getTime() + 1) }, 4, now)).toBe(false);
  expect(generationCandidateAvailable({ ...candidate, state: "running", leaseExpiresAt: new Date(now.getTime() + 1) }, 4, now)).toBe(false);
  expect(generationCandidateAvailable({ ...candidate, state: "running", leaseExpiresAt: new Date(now.getTime() - 1) }, 4, now)).toBe(true);
  expect(generationCandidateAvailable({ ...candidate, state: "ready" }, 4, now)).toBe(false);
});
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
