import { describe, expect, it } from "vitest";
import { decideExcusedSync, desiredExcusedRecord, groupExcusedRecords, parseExcusedSnapshot, type ExcusedRecord } from "./excused-sync.shared";

const remote: ExcusedRecord = {
  id: "remote-a", allianceId: "ashed-a", memberId: "member-a", recordType: "vs",
  startDate: "2026-09-10", endDate: "2026-09-12", reason: "Time off recorded in Alliance HQ.",
  changedAt: "2026-09-07T12:00:00.000Z",
};
const wire = {
  id: remote.id, alliance_id: remote.allianceId, member_id: remote.memberId,
  record_type: "vs", start_date: remote.startDate, end_date: remote.endDate,
  reason: remote.reason, updated_date: remote.changedAt,
};

describe("ExcusedRecord contract", () => {
  it("accepts scoped records and preserves the trustworthy last-change timestamp", () => {
    expect(parseExcusedSnapshot([wire], "ashed-a")).toEqual([remote]);
  });
  it.each([
    [{ ...wire, alliance_id: "other" }], [{ ...wire, member_id: null }],
    [{ ...wire, start_date: "2026-02-30" }], [{ ...wire, end_date: "2026-01-01" }],
    [{ ...wire, record_type: "other" }], [wire, wire], {}, null,
  ])("rejects incomplete or invalid snapshots instead of treating them as deletions", (body) => {
    expect(() => parseExcusedSnapshot(body, "ashed-a")).toThrow();
  });
  it("does not fabricate notice provenance from a missing or future timestamp", () => {
    expect(parseExcusedSnapshot([{ ...wire, updated_date: undefined }], "ashed-a")[0].changedAt).toBeNull();
    expect(parseExcusedSnapshot([{ ...wire, updated_date: "2999-01-01T00:00:00Z" }], "ashed-a")[0].changedAt).toBeNull();
  });
  it("pairs only one VS/donation record with identical dates and reason", () => {
    const donation = { ...remote, id: "donation-a", recordType: "donation" as const };
    expect(groupExcusedRecords([remote, donation])).toMatchObject([{ scope: "all", records: [remote, donation] }]);
    expect(groupExcusedRecords([remote, { ...donation, endDate: "2026-09-13" }])).toHaveLength(2);
    expect(groupExcusedRecords([remote, donation, { ...remote, id: "duplicate-vs" }])).toHaveLength(3);
  });
});

describe("outbound excusal intent", () => {
  const entry = { ashedMemberId: "member-a", startDate: remote.startDate, endDate: remote.endDate, entryKind: "planned", activityScope: "all", cancelledAt: null, notes: "PRIVATE_REASON" };
  it("uses only a generic localized reason, not private notes", () => {
    const desired = desiredExcusedRecord(entry, "ashed-a", "vs", remote.reason!);
    expect(desired).toMatchObject({ reason: remote.reason, memberId: "member-a" });
    expect(JSON.stringify(desired)).not.toContain("PRIVATE_REASON");
    expect(desiredExcusedRecord(entry, "ashed-a", "donation", "Ausência registrada no Alliance HQ.")?.recordType).toBe("donation");
  });
  it("never exports unexpected or cancelled absences or unrelated activity scopes", () => {
    expect(desiredExcusedRecord({ ...entry, entryKind: "unexpected" }, "ashed-a", "vs", "reason")).toBeNull();
    expect(desiredExcusedRecord({ ...entry, entryKind: "unknown" }, "ashed-a", "vs", "reason")).toBeNull();
    expect(desiredExcusedRecord({ ...entry, cancelledAt: new Date() }, "ashed-a", "vs", "reason")).toBeNull();
    expect(desiredExcusedRecord({ ...entry, activityScope: "donation" }, "ashed-a", "vs", "reason")).toBeNull();
  });
});

describe("safe sync decisions", () => {
  const desired = { ...remote };
  it("creates only when no mapped record, candidate or uncertain attempt exists", () => {
    expect(decideExcusedSync({ desired, remote: null, remoteId: null, baseline: null, uncertain: false, candidates: [] })).toBe("create");
    expect(decideExcusedSync({ desired, remote: null, remoteId: null, baseline: null, uncertain: true, candidates: [] })).toBe("uncertain");
    expect(decideExcusedSync({ desired, remote: null, remoteId: null, baseline: null, uncertain: false, candidates: [remote] })).toBe("uncertain");
  });
  it("does not resurrect a period deleted upstream or overwrite an external edit", () => {
    expect(decideExcusedSync({ desired, remote: null, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("conflict");
    expect(decideExcusedSync({ desired, remote: { ...remote, endDate: "2026-09-13" }, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("conflict");
  });
  it("replaces only a known unchanged record and treats matching content as already synced", () => {
    expect(decideExcusedSync({ desired, remote, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("done");
    expect(decideExcusedSync({ desired: { ...desired, endDate: "2026-09-14" }, remote, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("replace");
  });
  it("cancellation preserves uncertain creates and verifies mapped records before deleting", () => {
    expect(decideExcusedSync({ desired: null, remote: null, remoteId: null, baseline: null, uncertain: true, candidates: [] })).toBe("uncertain");
    expect(decideExcusedSync({ desired: null, remote, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("delete");
    expect(decideExcusedSync({ desired: null, remote: null, remoteId: remote.id, baseline: remote, uncertain: false, candidates: [] })).toBe("done");
  });
});
