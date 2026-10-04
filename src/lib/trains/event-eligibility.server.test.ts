import { describe, expect, it } from "vitest";

import { eventEligibilityFingerprint } from "@/lib/trains/event-eligibility.server";

describe("eventEligibilityFingerprint", () => {
  it("is stable for a canonical input regardless of key order", () => {
    const a = eventEligibilityFingerprint({
      target: "warzone-duel",
      candidates: ["b", "a"],
      nested: { x: 1, y: [2, 1] },
    });
    const b = eventEligibilityFingerprint({
      nested: { y: [2, 1], x: 1 },
      candidates: ["b", "a"],
      target: "warzone-duel",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the candidate set changes", () => {
    const base = { target: "warzone-duel", candidates: ["a"] };
    expect(eventEligibilityFingerprint(base)).not.toBe(
      eventEligibilityFingerprint({ target: "warzone-duel", candidates: ["a", "b"] }),
    );
  });
});
