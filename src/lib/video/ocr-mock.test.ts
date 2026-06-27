import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/members/roster.server", () => ({
  listAllianceMembers: vi.fn(async () => []),
}));

import { mockOcrRosterFrames, mockOcrScoreFrames } from "@/lib/video/ocr-mock";

describe("mockOcrScoreFrames", () => {
  it("loads desert-storm fixture deterministically", async () => {
    const entries = await mockOcrScoreFrames("desert-storm", [{ index: 0 }]);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.name).toBe("Commander Alpha");
    expect(entries[0]?.score).toBe("1250000");
  });

  it("returns the same rows on repeat calls", async () => {
    const a = await mockOcrScoreFrames("desert-storm", [{ index: 0 }]);
    const b = await mockOcrScoreFrames("desert-storm", [{ index: 0 }]);
    expect(a).toEqual(b);
  });
});

describe("mockOcrRosterFrames", () => {
  it("loads member-roster-video fixture", async () => {
    const members = await mockOcrRosterFrames("member-roster-video", [{ index: 2 }]);
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]?.currentName).toBe("Recruiter StarDust");
    expect(members[0]?._sourceFrameIndex).toBe(2);
  });
});
