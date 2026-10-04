import { describe, expect, it } from "vitest";
import { lastClosedVsWeek, complianceWeeks, resolveComplianceJoin, planComplianceMirror, validateComplianceCommand } from "./workflow.shared";

describe("durable compliance workflow decisions", () => {
  it.each([["2026-09-13T01:59:59.999Z", "2026-09-06"], ["2026-09-13T02:00:00.000Z", "2026-09-13"], ["2026-09-16T12:00:00.000Z", "2026-09-13"]])("resolves closed UTC-2 weeks at %s", (instant, ending) => expect(lastClosedVsWeek(new Date(instant))).toBe(ending));
  it("enumerates explicit Sunday identities across year boundaries", () => expect(complianceWeeks("2026-12-27", "2027-01-10")).toEqual(["2026-12-27", "2027-01-03", "2027-01-10"]));
  it("uses the latest current-stint evidence rather than an earlier tenure", () => {
    expect(resolveComplianceJoin(["2026-01-01T02:00:00Z", "2026-09-01T02:00:00Z"], "2026-01-01")).toBe("2026-09-01T02:00:00.000Z");
    expect(resolveComplianceJoin([], null)).toBeNull();
  });
  it("never treats apparent local target rank as proof of Ashed completion", () => {
    expect(planComplianceMirror({ kind: "demote", expectedRank: 3, targetRank: 2 }, { rank: 3, status: "active" })).toBe("write_rank");
    expect(planComplianceMirror({ kind: "demote", expectedRank: 3, targetRank: 2 }, { rank: 2, status: "active" })).toBe("verified");
  });
  it("does not overwrite a newer upstream promotion or an unknown rank", () => {
    for (const rank of [4, 5, null]) expect(planComplianceMirror({ kind: "demote", expectedRank: 3, targetRank: 2 }, { rank, status: "active" })).toBe("conflict");
  });
  it("requires verified upstream departure rather than assuming a remote removal contract", () => {
    expect(planComplianceMirror({ kind: "remove", expectedRank: 1, targetRank: null }, { rank: 1, status: "active" })).toBe("conflict");
    expect(planComplianceMirror({ kind: "remove", expectedRank: 1, targetRank: null }, { rank: 1, status: "former" })).toBe("verified");
  });
  it("validates durable request identity, opaque fingerprint and private waiver reason", () => {
    expect(validateComplianceCommand({ requestId: "request-12345", confirmationBasis: "a".repeat(64), reason: "  officer waiver  " }, true).reason).toBe("officer waiver");
    for (const reason of ["", " ", "x".repeat(2001)]) expect(() => validateComplianceCommand({ requestId: "request-12345", confirmationBasis: "a".repeat(64), reason }, true)).toThrow("reason_required");
    expect(() => validateComplianceCommand({ requestId: "x", confirmationBasis: "fake" }, false)).toThrow("changed");
  });
});
