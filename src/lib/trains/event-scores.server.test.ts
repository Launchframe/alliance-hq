import { describe, expect, it } from "vitest";

import { ashedEntityForEventKey } from "@/lib/trains/event-scores.server";

describe("ashedEntityForEventKey", () => {
  it("maps capitol war to KillScore", () => {
    expect(ashedEntityForEventKey("capitol_war")).toBe("KillScore");
  });

  it("falls back to VSScore for unknown keys", () => {
    expect(ashedEntityForEventKey("unknown_event")).toBe("VSScore");
  });
});
