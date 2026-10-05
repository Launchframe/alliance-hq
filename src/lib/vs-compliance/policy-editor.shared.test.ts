import { describe, expect, it } from "vitest";
import { VS_PREVIEW_OUTCOME_KEYS, vsPolicyEditorDraft, vsPolicyPatchFromDraft, vsPreviewIncomplete, type VsPolicyPreviewRow } from "./policy-editor.shared";
import { firstFullVsWeek, mergeVsPolicyPatch } from "./policy.shared";
import type { VsDailyPolicyVersion, VsLegacyPolicyVersion } from "./types.shared";

const NOW = new Date("2026-09-15T12:00:00Z");

const legacy = (overrides: Partial<VsLegacyPolicyVersion> = {}): VsLegacyPolicyVersion => ({
  modelVersion: 1, version: 3, enabled: true, dailyTarget: 5_000_000, weeklyMinimum: 30_000_000,
  leewayPct: 10, preset: "rank_aware", removalThreshold: 3, effectiveWeek: "2026-08-30", ...overrides,
});
const daily = (overrides: Partial<VsDailyPolicyVersion> = {}): VsDailyPolicyVersion => ({
  modelVersion: 2, version: 4, enabled: true, dailyTarget: 6_500_000, leewayPct: 5, allowedMissedDays: 2,
  demotion: { unit: "days", length: 4 }, promotion: { unit: "weeks", length: 3 }, effectiveWeek: "2026-08-30", ...overrides,
});

describe("vsPolicyEditorDraft", () => {
  it("creates a disabled v2 draft from no previous policy without auto-activating", () => {
    const draft = vsPolicyEditorDraft(null, NOW);
    expect(draft).toMatchObject({ enabled: false, dailyTarget: "7200000", leewayPct: "0", allowedMissedDays: "0", demotionUnit: "weeks", demotionLength: "1", promotionUnit: "weeks", promotionLength: "2", effectiveWeek: firstFullVsWeek(NOW) });
  });
  it("never carries enabled from an enabled v1 policy into the v2 draft", () => {
    const draft = vsPolicyEditorDraft(legacy({ enabled: true }), NOW);
    expect(draft.enabled).toBe(false);
    expect(draft.dailyTarget).toBe("5000000");
    expect(draft.leewayPct).toBe("10");
    expect(draft.effectiveWeek).toBe(firstFullVsWeek(NOW));
  });
  it("prefills exact v2 fields including enabled and keeps a later effective week", () => {
    const later = "2030-01-05";
    const draft = vsPolicyEditorDraft(daily({ effectiveWeek: later }), NOW);
    expect(draft).toMatchObject({ enabled: true, dailyTarget: "6500000", leewayPct: "5", allowedMissedDays: "2", demotionUnit: "days", demotionLength: "4", promotionUnit: "weeks", promotionLength: "3", effectiveWeek: later });
  });
  it("never rolls back an earlier effective week below the first full week", () => {
    expect(vsPolicyEditorDraft(daily({ effectiveWeek: "2020-01-05" }), NOW).effectiveWeek).toBe(firstFullVsWeek(NOW));
  });
});

describe("vsPolicyPatchFromDraft", () => {
  const valid = vsPolicyEditorDraft(daily(), NOW);
  it("builds a server-acceptable v2 patch", () => {
    const patch = vsPolicyPatchFromDraft(valid);
    expect(patch).toEqual({ modelVersion: 2, enabled: true, dailyTarget: 6_500_000, leewayPct: 5, allowedMissedDays: 2, demotion: { unit: "days", length: 4 }, promotion: { unit: "weeks", length: 3 }, effectiveWeek: valid.effectiveWeek });
    expect(() => mergeVsPolicyPatch(daily(), patch, NOW)).not.toThrow();
  });
  it.each([
    ["dailyTarget", "0"], ["dailyTarget", "1.5"], ["dailyTarget", ""], ["leewayPct", "101"], ["leewayPct", "-1"], ["leewayPct", ""],
    ["allowedMissedDays", "6"], ["allowedMissedDays", "-1"], ["allowedMissedDays", ""], ["demotionLength", "0"], ["promotionLength", "abc"], ["promotionLength", "   "],
  ] as const)("rejects invalid %s=%s", (field, value) => {
    expect(vsPolicyPatchFromDraft({ ...valid, [field]: value })).toBeNull();
  });
  it("accepts the maximum safe daily target and rejects beyond it", () => {
    expect(vsPolicyPatchFromDraft({ ...valid, dailyTarget: "9007199254740991" })).toMatchObject({ dailyTarget: 9_007_199_254_740_991 });
    expect(vsPolicyPatchFromDraft({ ...valid, dailyTarget: "9007199254740992" })).toBeNull();
  });
  it("rejects sequence lengths above the unit cap", () => {
    expect(vsPolicyPatchFromDraft({ ...valid, demotionUnit: "weeks", demotionLength: "53" })).toBeNull();
    expect(vsPolicyPatchFromDraft({ ...valid, demotionUnit: "days", demotionLength: "313" })).toBeNull();
  });
});

describe("preview mapping", () => {
  const row = (outcome: VsPolicyPreviewRow["outcome"]): VsPolicyPreviewRow => ({ memberId: "m", memberName: "M", currentRank: 3, outcome, counts: null, recommendationKind: "none", recommendationTargetRank: null, signal: null });
  it("maps outcomes exactly to member labels", () => {
    expect(VS_PREVIEW_OUTCOME_KEYS.passed).toBe("meeting");
    expect(VS_PREVIEW_OUTCOME_KEYS.missed).toBe("below");
    expect(VS_PREVIEW_OUTCOME_KEYS.pending_data).toBe("needsEvidence");
    expect(VS_PREVIEW_OUTCOME_KEYS.excused).toBe("excused");
    expect(VS_PREVIEW_OUTCOME_KEYS.waived).toBe("waived");
    expect(VS_PREVIEW_OUTCOME_KEYS.not_eligible).toBe("notEvaluated");
  });
  it("flags incomplete only when a row is pending_data", () => {
    expect(vsPreviewIncomplete([row("pending_data"), row("passed")])).toBe(true);
    expect(vsPreviewIncomplete([row("missed"), row("waived")])).toBe(false);
    expect(vsPreviewIncomplete([])).toBe(false);
  });
});
