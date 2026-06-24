import { describe, expect, it } from "vitest";

import {
  formatHeroPowerMForStorage,
  parsedRowsToRosterReviewRows,
} from "@/lib/video/roster-video-review.shared";

describe("roster-video-review.shared", () => {
  it("formats hero power for storage", () => {
    expect(formatHeroPowerMForStorage(94.1)).toBe("94.1M");
    expect(formatHeroPowerMForStorage(null)).toBeNull();
  });

  it("fuzzy-matches roster rows to HQ members on hydrate", () => {
    const rows = parsedRowsToRosterReviewRows(
      [
        {
          id: "1",
          ocrName: "Alpha Player",
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
      ],
      [
        {
          id: "m1",
          current_name: "AlphaPlayer",
          status: "active",
        },
      ],
      "LFgo",
    );

    expect(rows[0]?.memberId).toBe("m1");
    expect(rows[0]?.matchConfidence).toBeGreaterThan(0.6);
  });

  it("clears junk profession unless row was edited with valid value", () => {
    const rows = parsedRowsToRosterReviewRows(
      [
        {
          id: "1",
          ocrName: "Beta",
          profession: "Warlord",
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
        {
          id: "2",
          ocrName: "Gamma",
          profession: "Engineer",
          edited: 1,
          memberId: null,
          memberName: null,
          matchConfidence: 0,
          deleted: 0,
        },
      ],
      [],
      "LFgo",
    );

    expect(rows[0]?.profession).toBeNull();
    expect(rows[1]?.profession).toBe("Engineer");
  });
});
