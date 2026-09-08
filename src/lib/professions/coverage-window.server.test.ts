import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
vi.mock("@/lib/trains/game-time", () => ({ getServerCalendarDate: () => "2026-09-10" }));

import { schema } from "@/lib/db";
import { CoverageConflictError, withCoverageActor } from "@/lib/time-off/coverage.server";
import type { CoverageAcceptance, CoverageConflict } from "@/lib/time-off/coverage.shared";
import { updateCoverageWindow } from "./repository";

let assignment: { id: string; wlTeamId: string; engCommanderId: string; status: string; assignedAt: Date; coverageStartHour: number; coverageEndHour: number };
let version: string;
let absenceVersion: number;
let events: string[];
let audits: Array<{ metadata: { conflicts: CoverageConflict[] }; action: string }>;
let writes: Array<Record<string, unknown>>;
let connectionHeld: boolean;
const change = (start = 22, end = 4, acceptance?: CoverageAcceptance) => withCoverageActor({ allianceId: "alliance", hqUserId: "officer", acceptance }, () => updateCoverageWindow("assignment", start, end, "alliance"));
async function warning(start = 22, end = 4, acceptance?: CoverageAcceptance): Promise<CoverageConflict[]> {
  try { await change(start, end, acceptance); } catch (error) {
    expect(error).toBeInstanceOf(CoverageConflictError);
    return (error as CoverageConflictError).conflicts;
  }
  throw new Error("Expected coverage warning");
}
const approve = (conflicts: CoverageConflict[]): CoverageAcceptance => ({ conflicts, note: "Relief arranged", requestId: "request_1234567890" });

beforeEach(() => {
  version = "10";
  absenceVersion = 1;
  assignment = { id: "assignment", wlTeamId: "permanent-team", engCommanderId: "engineer", status: "active", assignedAt: new Date("2026-01-01T00:00:00Z"), coverageStartHour: 8, coverageEndHour: 16 };
  events = [];
  audits = [];
  writes = [];
  connectionHeld = false;
  const tx = {
    execute: async () => { events.push("availability"); },
    select: () => ({ from: (table: unknown) => {
      const result = () => table === schema.wlEngAssignments ? [{ row: assignment, version }]
        : table === schema.commanderAllianceMemberships ? [{ memberId: "member", memberName: "Engineer" }]
          : [{ id: "absence", version: absenceVersion, memberId: "member", startDate: "2026-09-11", endDate: "2026-09-12" }];
      const query = {
        innerJoin: () => query,
        where: () => Object.assign(Promise.resolve(result()), { for: async () => { events.push(table === schema.wlEngAssignments ? "assignment" : "source"); return result(); } }),
      };
      return query;
    } }),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => {
      events.push("write");
      writes.push(values);
      Object.assign(assignment, values);
      version = "11";
      return [{ version }];
    } }) }) }),
    insert: () => ({ values: (row: typeof audits[number]) => ({ onConflictDoNothing: async () => { events.push("audit"); audits.push(row); } }) }),
  } as unknown as AvailabilityTransaction;
  mocks.getDb.mockImplementation(() => {
    if (connectionHeld) throw new Error("Second connection acquired under locks");
    return { transaction: async (work: (connection: AvailabilityTransaction) => Promise<void>) => {
      connectionHeld = true;
      try { await work(tx); } finally { connectionHeld = false; }
    } };
  });
});

describe("manual Engineer coverage transaction", () => {
  it("checks all future absence dates before writing, using one connection and ordered locks", async () => {
    const conflicts = await warning();
    expect(new Set(conflicts.map((conflict) => conflict.dutyDate))).toEqual(new Set(["2026-09-11", "2026-09-12"]));
    expect(events).toEqual(["availability", "assignment", "source"]);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });
  it("rejects stale absence and assignment versions and a different proposed window", async () => {
    const conflicts = await warning();
    absenceVersion++;
    const fresh = await warning(22, 4, approve(conflicts));
    expect(fresh[0]!.absenceVersion).not.toBe(conflicts[0]!.absenceVersion);
    version = "12";
    const changed = await warning(22, 4, approve(fresh));
    expect(changed[0]!.assignmentVersion).toBe("12");
    await warning(21, 4, approve(changed));
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });
  it("applies the reviewed window without replacing permanent identity and audits the resulting version", async () => {
    const identity = { id: assignment.id, wlTeamId: assignment.wlTeamId, engCommanderId: assignment.engCommanderId, status: assignment.status, assignedAt: assignment.assignedAt };
    const conflicts = await warning();
    events = [];
    await change(22, 4, approve(conflicts));
    expect(assignment).toMatchObject(identity);
    expect(writes).toEqual([{ coverageStartHour: 22, coverageEndHour: 4, updatedAt: expect.any(Date) }]);
    expect(events).toEqual(["availability", "assignment", "source", "audit", "write", "audit"]);
    expect(audits.map((audit) => audit.action)).toEqual(["time_off.coverage_keep", "time_off.coverage_applied"]);
    expect(audits[1]!.metadata.conflicts.every((conflict) => conflict.assignmentVersion === "11")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('"absence"');
  });
});
