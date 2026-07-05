import { describe, expect, it } from "vitest";

import {
  hasDisciplineUpsertKey,
  parseAshedDisciplineRecord,
  shouldSkipAshedUpsertForManualRow,
} from "@/lib/members/member-discipline.shared";

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

describe("hasDisciplineUpsertKey", () => {
  it("requires ashed id or recorded date", () => {
    expect(
      hasDisciplineUpsertKey({
        ashedId: "c-1",
        type: null,
        notes: null,
        recordedDate: null,
        expungedAt: null,
      }),
    ).toBe(true);
    expect(
      hasDisciplineUpsertKey({
        ashedId: null,
        type: "Harassment",
        notes: "Only notes",
        recordedDate: "2026-01-01",
        expungedAt: null,
      }),
    ).toBe(true);
    expect(
      hasDisciplineUpsertKey({
        ashedId: null,
        type: "Harassment",
        notes: "Only notes",
        recordedDate: null,
        expungedAt: null,
      }),
    ).toBe(false);
  });
});

describe("shouldSkipAshedUpsertForManualRow", () => {
  it("updates rows matched by Ashed id", () => {
    expect(
      shouldSkipAshedUpsertForManualRow({
        matchedByAshedId: true,
        existingAshedId: "v-1",
      }),
    ).toBe(false);
  });

  it("skips natural-key matches on manual-only rows", () => {
    expect(
      shouldSkipAshedUpsertForManualRow({
        matchedByAshedId: false,
        existingAshedId: null,
      }),
    ).toBe(true);
  });

  it("updates natural-key matches when the row is already Ashed-linked", () => {
    expect(
      shouldSkipAshedUpsertForManualRow({
        matchedByAshedId: false,
        existingAshedId: "v-legacy",
      }),
    ).toBe(false);
  });
});
