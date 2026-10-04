import { describe, expect, it } from "vitest";

import {
  canManageTimeOffEntry,
  parseTimeOffDraft,
  timeOffEntryForViewer,
  timeOffExcusesDate,
  type TimeOffRevisionSnapshot,
} from "./workflow.shared";

const draft = {
  ashedMemberId: "member-a",
  startDate: "2026-09-09",
  endDate: "2026-09-10",
  notes: "Private family circumstances",
};
const snapshot: TimeOffRevisionSnapshot = {
  startDate: draft.startDate,
  endDate: draft.endDate,
  entryKind: "planned",
  globalAbsence: true,
  cancelled: false,
};
const revision = (recordedAt: string, patch: Partial<TimeOffRevisionSnapshot> = {}) => ({
  recordedAt,
  snapshot: { ...snapshot, ...patch },
});

describe("time-off draft validation", () => {
  it("normalizes a global absence without accepting client attribution", () => {
    expect(parseTimeOffDraft({ ...draft, source: "officer", memberName: "Spoof", availability: "minimums" })).toEqual({
      ...draft,
      entryKind: "planned",
    });
  });

  it.each(["2026-02-29", "2026-09-31", "2026-13-01", "2026-00-01", "not-a-date"])("rejects impossible date %s", (startDate) => {
    expect(() => parseTimeOffDraft({ ...draft, startDate })).toThrow("invalidDate");
  });

  it("accepts leap days and inclusive same-day periods", () => {
    expect(parseTimeOffDraft({ ...draft, startDate: "2028-02-29", endDate: "2028-02-29" }).startDate).toBe("2028-02-29");
  });

  it("rejects backwards and unbounded periods", () => {
    expect(() => parseTimeOffDraft({ ...draft, endDate: "2026-09-08" })).toThrow("invalidRange");
    expect(() => parseTimeOffDraft({ ...draft, endDate: "2028-09-09" })).toThrow("rangeTooLong");
    expect(() => parseTimeOffDraft({ ...draft, notes: "x".repeat(1001) })).toThrow("notesTooLong");
  });

  it.each([null, [], "body", { ...draft, ashedMemberId: 4 }, { ...draft, notes: {} }])("rejects malformed payloads without an unsafe coercion", (body) => {
    expect(() => parseTimeOffDraft(body)).toThrow();
  });
});

describe("time-off ownership and private notes", () => {
  it("does not let a member change another commander's entry or an officer flag", () => {
    expect(canManageTimeOffEntry({ entryKind: "planned", canManageOthers: false, ownsCommander: false })).toBe(false);
    expect(canManageTimeOffEntry({ entryKind: "unexpected", canManageOthers: false, ownsCommander: true })).toBe(false);
    expect(canManageTimeOffEntry({ entryKind: "officer_marked", canManageOthers: false, ownsCommander: true })).toBe(false);
    expect(canManageTimeOffEntry({ entryKind: "unknown", canManageOthers: true, ownsCommander: true })).toBe(false);
  });

  it("allows own planned entries and officer management", () => {
    expect(canManageTimeOffEntry({ entryKind: "planned", canManageOthers: false, ownsCommander: true })).toBe(true);
    expect(canManageTimeOffEntry({ entryKind: "unexpected", canManageOthers: true, ownsCommander: false })).toBe(true);
  });

  it("redacts notes in DTOs rather than relying on the client", () => {
    const entry = { ashedMemberId: "member-a", notes: "private" };
    expect(timeOffEntryForViewer(entry, { canManageOthers: false, ownedCommanderIds: [] }).notes).toBeNull();
    expect(timeOffEntryForViewer(entry, { canManageOthers: false, ownedCommanderIds: ["member-b"] }).notes).toBeNull();
    expect(timeOffEntryForViewer(entry, { canManageOthers: false, ownedCommanderIds: ["member-a"] }).notes).toBe("private");
    expect(timeOffEntryForViewer(entry, { canManageOthers: true, ownedCommanderIds: [] }).notes).toBe("private");
    expect(entry.notes).toBe("private");
  });
});

describe("immutable prior-notice eligibility", () => {
  it("requires notice strictly before the UTC-2 day starts", () => {
    expect(timeOffExcusesDate([revision("2026-09-09T01:59:59.999Z")], "2026-09-09")).toBe(true);
    expect(timeOffExcusesDate([revision("2026-09-09T02:00:00.000Z")], "2026-09-09")).toBe(false);
    expect(timeOffExcusesDate([revision("2026-09-09T03:00:00.000Z")], "2026-09-10")).toBe(true);
  });

  it("does not backdate an extension using the original creation time", () => {
    const revisions = [
      revision("2026-09-08T12:00:00Z", { endDate: "2026-09-09" }),
      revision("2026-09-10T10:00:00Z", { endDate: "2026-09-12" }),
    ];
    expect(timeOffExcusesDate(revisions, "2026-09-09")).toBe(true);
    expect(timeOffExcusesDate(revisions, "2026-09-10")).toBe(false);
    expect(timeOffExcusesDate(revisions, "2026-09-11")).toBe(true);
  });

  it("respects cancellation before the cutoff but does not rewrite history", () => {
    const revisions = [revision("2026-09-08T12:00:00Z"), revision("2026-09-09T10:00:00Z", { cancelled: true })];
    expect(timeOffExcusesDate(revisions, "2026-09-09")).toBe(true);
    expect(timeOffExcusesDate(revisions, "2026-09-10")).toBe(false);
  });

  it("never treats unexpected or unverifiable legacy absence as an excuse", () => {
    expect(timeOffExcusesDate([revision("2026-09-08T12:00:00Z", { entryKind: "unexpected" })], "2026-09-09")).toBe(false);
    expect(timeOffExcusesDate([revision("2026-09-08T12:00:00Z", { globalAbsence: false })], "2026-09-09")).toBe(false);
    expect(timeOffExcusesDate([], "2026-09-09")).toBe(false);
  });
});
