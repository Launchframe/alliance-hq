import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assembleComplianceWeek, resolveComplianceEvidence, type loadComplianceFacts, type ExternalComplianceEvidence } from "./evidence.server";

type Facts = Awaited<ReturnType<typeof loadComplianceFacts>>;
function facts(extra: Record<string, unknown> = {}): Facts {
  return { heads: [{ id: "score", version: 1, memberId: "member", recordedDate: "2026-09-13", period: "weekly", origin: "hq", score: 1 }], scopes: [], entries: [], revisions: [], ...extra } as unknown as Facts;
}
const native: ExternalComplianceEvidence = { native: true, verifiedAt: null, weeks: new Map(), excuses: [] };
const missingAshed: ExternalComplianceEvidence = { ...native, native: false };

describe("canonical daily read evidence", () => {
  const ending = "2026-09-13";
  const head = (date: string, score: number | null, origin = "hq") => ({ id: date, version: 1, memberId: "member", recordedDate: date, period: "daily", origin, score });
  it("keeps weekly-only readiness separate from six unknown daily values", () => {
    const result = resolveComplianceEvidence(facts(), "member", ending, native);
    expect(result.evidence.state).toBe("ready");
    expect(result.daily.map((day) => day.date)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(result.daily.every((day) => day.score === null && day.state === "missing")).toBe(true);
  });
  it("preserves explicit zero and HQ authority without leaking source ids", () => {
    const external = { ...native, weeks: new Map([[ending, new Map([["member", [{ id: "ashed:private", recordedDate: "2026-09-07", period: "daily" as const, score: 99 }]]])]]) };
    const result = resolveComplianceEvidence(facts({ heads: [head("2026-09-07", 0)] }), "member", ending, external);
    expect(result.daily[0]).toMatchObject({ score: 0, state: "ready", source: "hq" });
    expect(result.daily[1]).toMatchObject({ score: null, state: "missing", source: null });
    expect(JSON.stringify(result.daily)).not.toContain("private");
  });
  it("does not choose a conflicting score or use unverified upstream as zero", () => {
    const remote = [1, 2].map((score) => ({ id: `ashed:${score}`, recordedDate: "2026-09-07", period: "daily" as const, score }));
    expect(resolveComplianceEvidence(facts({ heads: [] }), "member", ending, native, remote).daily[0]).toMatchObject({ score: null, state: "conflict" });
    expect(resolveComplianceEvidence(facts({ heads: [] }), "member", ending, missingAshed, [remote[0]]).daily[0]).toMatchObject({ score: null, state: "partial", sourceReady: false });
  });
  it("derives Saturday only from a valid full Mon-Fri basis and ignores its own upstream mirror", () => {
    const state = facts(); state.heads[0].score = 60;
    state.heads.push(...[7, 8, 9, 10, 11].map((day) => head(`2026-09-${String(day).padStart(2, "0")}`, 10)) as Facts["heads"]);
    state.heads.push(head("2026-09-12", 10, "derived") as Facts["heads"][number]);
    state.scopes.push({ recordedDate: "2026-09-12", period: "daily", managedScores: { member: { previous: 9, desired: 10 } } } as unknown as Facts["scopes"][number]);
    const remote = [{ id: "ashed:mirror", recordedDate: "2026-09-12", period: "daily" as const, score: 10 }];
    expect(resolveComplianceEvidence(state, "member", ending, native, remote).daily[5]).toMatchObject({ score: 10, source: "derived", state: "ready" });
    state.heads[6].origin = "hq"; state.heads[6].score = 11;
    expect(resolveComplianceEvidence(state, "member", ending, native, remote).daily[5]).toMatchObject({ score: 11, source: "hq" });
    state.heads[6].score = null;
    expect(resolveComplianceEvidence(state, "member", ending, native, remote).daily[5].score).toBeNull();
    state.heads.splice(6, 1); state.heads.splice(1, 1);
    expect(resolveComplianceEvidence(state, "member", ending, native).daily[5].score).toBeNull();
  });
  it("never derives Saturday from conflicting, invalid or excessive Mon-Fri scores", () => {
    const daily = [7, 8, 9, 10, 11].map((day) => ({ id: `ashed:${day}`, recordedDate: `2026-09-${String(day).padStart(2, "0")}`, period: "daily" as const, score: 10 }));
    for (const remote of [[...daily, { ...daily[0], id: "ashed:conflict", score: 11 }], daily.map((row, index) => index === 0 ? { ...row, score: -1 } : row), daily]) {
      const result = resolveComplianceEvidence(facts(), "member", ending, native, remote);
      expect(result.evidence.state).toBe("conflict");
      expect(result.daily[5]).toMatchObject({ score: null, source: null });
    }
  });
  it("separates global away from activity excusal and applies the strict UTC-2 cutoff per day", () => {
    const state = facts({ entries: [{ id: "absence", memberId: "member", startDate: "2026-09-07", endDate: "2026-09-09", globalAbsence: true, noticeVerified: true, syncStatus: "local", cancelledAt: null }], revisions: [{ entryId: "absence", version: 1, recordedAt: new Date("2026-09-07T02:00:00Z"), snapshot: { startDate: "2026-09-07", endDate: "2026-09-09", globalAbsence: true, entryKind: "planned", cancelled: false } }] });
    expect(resolveComplianceEvidence(state, "member", ending, native).daily.map((day) => [day.away, day.excused])).toEqual([[true, false], [true, true], [true, true], [false, false], [false, false], [false, false]]);
    const external = { ...native, excuses: [{ id: "private", allianceId: "upstream", memberId: "member", recordType: "vs" as const, startDate: "2026-09-10", endDate: "2026-09-13", changedAt: "2026-09-10T01:59:59.999Z", reason: "private" }] };
    expect(resolveComplianceEvidence(facts(), "member", ending, external).daily[3]).toMatchObject({ away: false, excused: true });
    external.excuses[0].startDate = "2026-09-13";
    expect(resolveComplianceEvidence(facts(), "member", ending, external).daily.some((day) => day.excused)).toBe(false);
  });
});

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
