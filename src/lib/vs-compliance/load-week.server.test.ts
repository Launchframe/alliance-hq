import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateVsWeek } from "@/lib/vs-scores/evidence.shared";

const mocks = vi.hoisted(() => ({ scores: vi.fn(), availability: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/vs-scores/load-week.server", () => ({ loadVsWeekEvidence: mocks.scores }));
vi.mock("@/lib/time-off/availability.server", () => ({ loadTimeOffAvailability: mocks.availability }));
import { loadVsComplianceWeekEvidence } from "./load-week.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scores.mockResolvedValue({ members: new Map([["native-member", evaluateVsWeek([], "2026-09-13")]]), externalAvailable: false });
  mocks.availability.mockResolvedValue({ excusedMemberIds: new Set(), pendingMemberIds: new Set(), awayMemberIds: new Set() });
});

describe("native weekly compliance adapter", () => {
  it("loads only Mon–Sat VS availability for the explicit Sunday identity and same alliance", async () => {
    await loadVsComplianceWeekEvidence("alliance-a", "2026-09-13");
    expect(mocks.scores).toHaveBeenCalledExactlyOnceWith("alliance-a", "2026-09-13");
    expect(mocks.availability.mock.calls).toEqual([7, 8, 9, 10, 11, 12].map((day) => ["alliance-a", `2026-09-${String(day).padStart(2, "0")}`, "vs"]));
  });

  it("keeps missing evidence unknown without requiring an Ashed connection", async () => {
    const result = await loadVsComplianceWeekEvidence("native-alliance", "2026-09-13");
    expect(result.get("native-member")).toMatchObject({ evidence: { state: "missing", score: null }, excused: false, pendingExcusal: false });
  });

  it("any qualifying day exempts the whole week and preserves pending excuse uncertainty", async () => {
    mocks.availability.mockImplementation(async (_alliance: string, date: string) => ({ excusedMemberIds: new Set(date === "2026-09-10" ? ["native-member"] : []), pendingMemberIds: new Set(date === "2026-09-11" ? ["native-member"] : []) }));
    expect((await loadVsComplianceWeekEvidence("alliance-a", "2026-09-13")).get("native-member")).toMatchObject({ excused: true, pendingExcusal: true });
  });

  it("does not turn scheduling-only absence into excusal", async () => {
    mocks.availability.mockResolvedValue({ excusedMemberIds: new Set(), pendingMemberIds: new Set(), awayMemberIds: new Set(["native-member"]) });
    expect((await loadVsComplianceWeekEvidence("alliance-a", "2026-09-13")).get("native-member")?.excused).toBe(false);
  });

  it("fails closed on unavailable excusal reads rather than evaluating a false miss", async () => {
    mocks.availability.mockRejectedValue(new Error("unavailable"));
    await expect(loadVsComplianceWeekEvidence("alliance-a", "2026-09-13")).rejects.toThrow("unavailable");
  });

  it("rejects invalid week identity before I/O", async () => {
    await expect(loadVsComplianceWeekEvidence("alliance-a", "2026-09-14")).rejects.toThrow("invalid_week");
    expect(mocks.scores).not.toHaveBeenCalled();
    expect(mocks.availability).not.toHaveBeenCalled();
  });
});
