import { describe, expect, it } from "vitest";
import { acceptsCoverage, type CoverageConflict } from "./coverage.shared";

const conflict: CoverageConflict = { assignmentId: "draft", assignmentVersion: "1", dutyDate: "2026-09-10", dutyRole: "conductor", memberId: "member", memberName: "Commander", lockedAt: null, absenceVersion: "absence-1" };
const acceptance = { conflicts: [conflict], note: "Coverage confirmed", requestId: "request_1234567890" };

describe("version-bound coverage acceptance", () => {
  it("accepts the reviewed duty with an explicit audit note", () => {
    expect(acceptsCoverage([conflict], acceptance)).toBe(true);
  });
  it("does not accept a boolean or an empty audit note", () => {
    expect(acceptsCoverage([conflict], undefined)).toBe(false);
    expect(acceptsCoverage([conflict], { ...acceptance, note: " " })).toBe(false);
  });
  for (const field of Object.keys(conflict) as (keyof CoverageConflict)[]) {
    it(`invalidates acceptance when ${field} changes`, () => {
      expect(acceptsCoverage([{ ...conflict, [field]: "changed" }], acceptance)).toBe(false);
    });
  }
  it("requires every conflicted assignment to be reviewed", () => {
    expect(acceptsCoverage([conflict, { ...conflict, dutyRole: "vip" }], acceptance)).toBe(false);
  });
});
