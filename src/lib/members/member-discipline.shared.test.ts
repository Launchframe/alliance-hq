import { describe, expect, it } from "vitest";

import { parseAshedDisciplineRecord } from "@/lib/members/member-discipline.shared";

describe("parseAshedDisciplineRecord", () => {
  it("parses violation fields from Ashed snake_case", () => {
    const parsed = parseAshedDisciplineRecord(
      {
        id: "v-1",
        violation_type: "Harassment",
        notes: "First offense",
        recorded_date: "2026-01-15",
      },
      "violation",
    );
    expect(parsed).toEqual({
      ashedId: "v-1",
      type: "Harassment",
      notes: "First offense",
      recordedDate: "2026-01-15",
      expungedAt: null,
    });
  });

  it("parses commendation fields from camelCase", () => {
    const parsed = parseAshedDisciplineRecord(
      {
        ashed_id: "c-9",
        commendationType: "Alliance Star",
        notes: "Great work",
        date: "2026-02-01",
      },
      "commendation",
    );
    expect(parsed).toEqual({
      ashedId: "c-9",
      type: "Alliance Star",
      notes: "Great work",
      recordedDate: "2026-02-01",
      expungedAt: null,
    });
  });

  it("reads expungedAt for violations", () => {
    const parsed = parseAshedDisciplineRecord(
      {
        id: "v-2",
        type: "Spam",
        expunged_at: "2026-03-01T12:00:00.000Z",
      },
      "violation",
    );
    expect(parsed.expungedAt?.toISOString()).toBe("2026-03-01T12:00:00.000Z");
  });
});
