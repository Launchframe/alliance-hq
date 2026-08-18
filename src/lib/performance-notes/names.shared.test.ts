import { describe, expect, it } from "vitest";

import { splitCommanderNames } from "@/lib/performance-notes/names.shared";
import { decideNameMatch } from "@/lib/performance-notes/match.shared";
import { parsePerformanceNotesPending } from "@/lib/performance-notes/pending-state";
import type { AshedMember } from "@/lib/video/member-matcher";

const roster: AshedMember[] = [
  { id: "m1", current_name: "Cookie" },
  { id: "m2", current_name: "Ferg" },
  { id: "m3", current_name: "RahRah" },
];

describe("splitCommanderNames", () => {
  it("splits commas, periods, and and", () => {
    expect(splitCommanderNames("Cookie. Ferg. RahRah")).toEqual([
      "Cookie",
      "Ferg",
      "RahRah",
    ]);
    expect(splitCommanderNames("Cookie, Ferg and RahRah")).toEqual([
      "Cookie",
      "Ferg",
      "RahRah",
    ]);
  });
});

describe("decideNameMatch", () => {
  it("auto-accepts exact names", () => {
    expect(decideNameMatch("Cookie", roster)).toEqual({
      action: "auto",
      memberId: "m1",
      memberName: "Cookie",
    });
  });

  it("asks for clarification on a weak unique fuzzy hit", () => {
    const decision = decideNameMatch("Cooki", roster);
    expect(decision.action).toBe("clarify");
    if (decision.action === "clarify") {
      expect(decision.candidates[0]?.memberId).toBe("m1");
    }
  });

  it("returns none when nothing is close", () => {
    expect(decideNameMatch("zzzzzz", roster)).toEqual({
      action: "none",
      token: "zzzzzz",
    });
  });
});

describe("parsePerformanceNotesPending", () => {
  it("parses attach pending", () => {
    expect(
      parsePerformanceNotesPending({ kind: "perf_note_attach", noteId: "n1" }),
    ).toEqual({ kind: "perf_note_attach", noteId: "n1" });
  });

  it("rejects unknown kinds", () => {
    expect(parsePerformanceNotesPending({ kind: "nope" })).toBeNull();
  });
});
