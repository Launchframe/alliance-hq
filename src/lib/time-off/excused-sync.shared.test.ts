import { describe, expect, it } from "vitest";

import {
  activityScopeToRecordTypes,
  groupParsedExcusedRecordsIntoEntries,
  parseAshedExcusedRecord,
  type ParsedAshedExcusedRecord,
} from "@/lib/time-off/excused-sync.shared";

describe("parseAshedExcusedRecord", () => {
  it("parses a well-formed vs record", () => {
    expect(
      parseAshedExcusedRecord({
        id: "rec_1",
        record_type: "vs",
        start_date: "2026-08-01",
        end_date: "2026-08-05",
        reason: "Vacation",
        alliance_id: "ashed_alliance_1",
        member_id: "ashed_member_1",
      }),
    ).toEqual({
      ashedId: "rec_1",
      recordType: "vs",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      reason: "Vacation",
      allianceId: "ashed_alliance_1",
      memberId: "ashed_member_1",
    });
  });

  it("is case-insensitive on record_type", () => {
    const parsed = parseAshedExcusedRecord({
      id: "rec_2",
      record_type: "DONATION",
      start_date: "2026-08-01",
      end_date: "2026-08-01",
    });
    expect(parsed?.recordType).toBe("donation");
  });

  it("truncates an ISO datetime to a date-only string", () => {
    const parsed = parseAshedExcusedRecord({
      id: "rec_3",
      record_type: "vs",
      start_date: "2026-08-01T00:00:00.000Z",
      end_date: "2026-08-05T23:59:59.000Z",
    });
    expect(parsed?.startDate).toBe("2026-08-01");
    expect(parsed?.endDate).toBe("2026-08-05");
  });

  it("accepts a numeric id", () => {
    const parsed = parseAshedExcusedRecord({
      id: 42,
      record_type: "vs",
      start_date: "2026-08-01",
      end_date: "2026-08-01",
    });
    expect(parsed?.ashedId).toBe("42");
  });

  it("treats a blank reason as null", () => {
    const parsed = parseAshedExcusedRecord({
      id: "rec_4",
      record_type: "vs",
      start_date: "2026-08-01",
      end_date: "2026-08-01",
      reason: "   ",
    });
    expect(parsed?.reason).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(
      parseAshedExcusedRecord({
        record_type: "vs",
        start_date: "2026-08-01",
        end_date: "2026-08-01",
      }),
    ).toBeNull();
  });

  it("returns null when record_type is unrecognized", () => {
    expect(
      parseAshedExcusedRecord({
        id: "rec_5",
        record_type: "sick_leave",
        start_date: "2026-08-01",
        end_date: "2026-08-01",
      }),
    ).toBeNull();
  });

  it("returns null when dates are missing or malformed", () => {
    expect(
      parseAshedExcusedRecord({
        id: "rec_6",
        record_type: "vs",
        start_date: "not-a-date",
        end_date: "2026-08-01",
      }),
    ).toBeNull();
    expect(
      parseAshedExcusedRecord({
        id: "rec_7",
        record_type: "vs",
        start_date: "2026-08-01",
      }),
    ).toBeNull();
  });
});

describe("activityScopeToRecordTypes", () => {
  it("maps vs to a single POST", () => {
    expect(activityScopeToRecordTypes("vs")).toEqual(["vs"]);
  });

  it("maps donation to a single POST", () => {
    expect(activityScopeToRecordTypes("donation")).toEqual(["donation"]);
  });

  it("maps all to two POSTs (vs + donation)", () => {
    expect(activityScopeToRecordTypes("all")).toEqual(["vs", "donation"]);
  });
});

function record(
  overrides: Partial<ParsedAshedExcusedRecord>,
): ParsedAshedExcusedRecord {
  return {
    ashedId: "rec",
    recordType: "vs",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    reason: "Vacation",
    allianceId: "ashed_alliance_1",
    memberId: "ashed_member_1",
    ...overrides,
  };
}

describe("groupParsedExcusedRecordsIntoEntries", () => {
  it("merges a matching vs + donation pair into one 'all' entry", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs" }),
      record({ ashedId: "don_1", recordType: "donation" }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      activityScope: "all",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      reason: "Vacation",
      ashedExcusedIds: ["vs_1", "don_1"],
    });
  });

  it("keeps a vs-only record as its own 'vs' entry", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs" }),
    ]);

    expect(entries).toEqual([
      {
        activityScope: "vs",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        reason: "Vacation",
        ashedExcusedIds: ["vs_1"],
      },
    ]);
  });

  it("keeps a donation-only record as its own 'donation' entry", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "don_1", recordType: "donation" }),
    ]);

    expect(entries).toEqual([
      {
        activityScope: "donation",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        reason: "Vacation",
        ashedExcusedIds: ["don_1"],
      },
    ]);
  });

  it("does not merge a vs + donation pair with different reasons", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs", reason: "Vacation" }),
      record({ ashedId: "don_1", recordType: "donation", reason: "Sick" }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.activityScope).sort()).toEqual([
      "donation",
      "vs",
    ]);
  });

  it("does not merge a vs + donation pair with different date ranges", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs", endDate: "2026-08-05" }),
      record({ ashedId: "don_1", recordType: "donation", endDate: "2026-08-06" }),
    ]);

    expect(entries).toHaveLength(2);
  });

  it("splits duplicate same-type records sharing a key into individual entries", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs" }),
      record({ ashedId: "vs_2", recordType: "vs" }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.activityScope === "vs")).toBe(true);
    expect(entries.map((e) => e.ashedExcusedIds)).toEqual([
      ["vs_1"],
      ["vs_2"],
    ]);
  });

  it("buckets records with different date ranges into separate entries", () => {
    const entries = groupParsedExcusedRecordsIntoEntries([
      record({ ashedId: "vs_1", recordType: "vs", startDate: "2026-08-01" }),
      record({ ashedId: "vs_2", recordType: "vs", startDate: "2026-09-01" }),
    ]);

    expect(entries).toHaveLength(2);
  });

  it("returns an empty list for no records", () => {
    expect(groupParsedExcusedRecordsIntoEntries([])).toEqual([]);
  });
});
