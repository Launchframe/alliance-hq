import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assembleComplianceWeek, type loadComplianceFacts, type ExternalComplianceEvidence } from "./evidence.server";

type Facts = Awaited<ReturnType<typeof loadComplianceFacts>>;
function facts(extra: Record<string, unknown> = {}): Facts {
  return { heads: [{ id: "score", version: 1, memberId: "member", recordedDate: "2026-09-13", period: "weekly", origin: "hq", score: 1 }], scopes: [], entries: [], revisions: [], ...extra } as unknown as Facts;
}
const native: ExternalComplianceEvidence = { native: true, verifiedAt: null, weeks: new Map(), excuses: [] };
const missingAshed: ExternalComplianceEvidence = { ...native, native: false };

describe("locked evidence assembly and excusal source health", () => {
  it("uses native verified weekly evidence without inventing a daily sum", () => {
    expect(assembleComplianceWeek(facts(), "member", "2026-09-13", native)).toMatchObject({ evidence: { state: "ready", score: 1, source: "weekly" }, pendingExcusal: false });
  });
  it("holds adverse Ashed-alliance evaluation if the complete external excuse snapshot is unavailable", () => {
    expect(assembleComplianceWeek(facts(), "member", "2026-09-13", missingAshed)).toMatchObject({ pendingExcusal: true, excused: false });
  });
  it("continues trusting timely HQ proof even when the Ashed source is unavailable", () => {
    const state = facts({ entries: [{ id: "absence", memberId: "member", startDate: "2026-09-09", endDate: "2026-09-09", noticeVerified: true }], revisions: [{ entryId: "absence", version: 1, recordedAt: new Date("2026-09-09T01:59:59.999Z"), snapshot: { startDate: "2026-09-09", endDate: "2026-09-09", globalAbsence: true, entryKind: "planned", cancelled: false } }] });
    expect(assembleComplianceWeek(state, "member", "2026-09-13", missingAshed)).toMatchObject({ excused: true, pendingExcusal: true });
    state.revisions[0].recordedAt = new Date("2026-09-09T02:00:00.000Z");
    expect(assembleComplianceWeek(state, "member", "2026-09-13", native).excused).toBe(false);
  });
  it("does not treat Sunday-only, donation-only, unexpected or late evidence as an automatic excuse", () => {
    for (const change of [{ startDate: "2026-09-13", endDate: "2026-09-13" }, { recordType: "donation" as const }, { changedAt: "2026-09-10T02:00:00.000Z" }]) {
      const external: ExternalComplianceEvidence = { ...native, native: false, verifiedAt: new Date(), weeks: new Map([["2026-09-13", new Map()]]), excuses: [{ id: "remote", allianceId: "upstream", memberId: "member", recordType: "vs", startDate: "2026-09-10", endDate: "2026-09-10", changedAt: "2026-09-01T00:00:00Z", reason: null, ...change }] };
      expect(assembleComplianceWeek(facts(), "member", "2026-09-13", external).excused).toBe(false);
    }
  });
  it("preserves explicit HQ tombstones against stale upstream rows", () => {
    const state = facts(); state.heads[0].score = null;
    const external: ExternalComplianceEvidence = { ...native, weeks: new Map([["2026-09-13", new Map([["member", [{ id: "ashed:stale", recordedDate: "2026-09-13", period: "weekly", score: 0 }]]])]]) };
    expect(assembleComplianceWeek(state, "member", "2026-09-13", external).evidence.state).toBe("missing");
  });
  it("retains previously verified historical evidence for chronological display while requiring a fresh excuse-source snapshot", () => {
    const external: ExternalComplianceEvidence = { ...native, native: false, verifiedAt: new Date() };
    const cached = [{ id: "ashed:weekly", period: "weekly" as const, recordedDate: "2026-09-13", score: 1 }];
    expect(assembleComplianceWeek(facts({ heads: [] }), "member", "2026-09-13", external, cached, new Date("2026-01-01"))).toMatchObject({ evidence: { state: "ready", score: 1 }, pendingExcusal: false });
    expect(assembleComplianceWeek(facts({ heads: [] }), "member", "2026-09-13", missingAshed, cached, new Date("2026-01-01")).pendingExcusal).toBe(true);
  });
  it("requires trustworthy notice timing for imported exemptions", () => {
    const external: ExternalComplianceEvidence = { ...native, verifiedAt: new Date(), excuses: [{ id: "remote", allianceId: "upstream", memberId: "member", recordType: "vs", startDate: "2026-09-10", endDate: "2026-09-10", changedAt: null, reason: null }] };
    expect(assembleComplianceWeek(facts(), "member", "2026-09-13", external)).toMatchObject({ pendingExcusal: true, excused: false });
  });
});
