import { describe, expect, it } from "vitest";
import { actionBody, ComplianceClientError, createActionAttempt, isDashboard, isMembershipSettings, isPolicy, readComplianceResponse, RequestVersion, syncLabel, type ComplianceRow } from "./client.shared";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ComplianceDailyEvidence, ComplianceEvidence } from "./ComplianceEvidence";
import { ComplianceHistoryRecords } from "./ComplianceHistory";
import { addCalendarDays } from "@/lib/trains/game-time";
import en from "../../../messages/en-US.json";
import pt from "../../../messages/pt-BR.json";

const row: ComplianceRow = { id: "task", memberId: "member", memberName: "Commander", currentRank: 3, weekEnding: "2026-09-06", outcome: "missed", threshold: 40_000_000, score: 0, policyVersion: 1, streak: 1, recommendation: { kind: "demote", targetRank: 2 }, evaluationBasis: "a".repeat(64), confirmationBasis: "b".repeat(64), settled: null, correctionReview: false, evidenceState: "ready", syncStatus: "local", dailyTarget: 7_200_000, daily: Array.from({ length: 6 }, (_, index) => ({ date: addCalendarDays("2026-09-06", index - 6), score: index === 0 ? 0 : null, state: index === 0 ? "ready" : "missing", source: index === 0 ? "hq" : null, sourceReady: true, away: false, excused: false, pendingExcusal: false })) };

describe("compliance client request safety", () => {
  it("retains the exact confirmation basis and UUID across uncertain retries", () => {
    const mutable = structuredClone(row);
    const attempt = createActionAttempt(mutable, "complete", "");
    const first = JSON.stringify(actionBody(attempt));
    mutable.confirmationBasis = "c".repeat(64);
    mutable.recommendation = { kind: "remove", targetRank: null };
    expect(JSON.stringify(actionBody(attempt))).toBe(first);
    expect(attempt.row.recommendation).toEqual({ kind: "demote", targetRank: 2 });
    expect(attempt.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createActionAttempt(row, "complete", "").requestId).not.toBe(attempt.requestId);
    expect(actionBody(attempt)).not.toHaveProperty("reason");
  });
  it("keeps private waiver input in the frozen command without modifying the row", () => {
    const attempt = createActionAttempt(row, "waive", "  Private reason  ");
    expect(actionBody(attempt)).toMatchObject({ reason: "Private reason", confirmationBasis: row.confirmationBasis });
    expect(attempt.row).not.toHaveProperty("reason");
  });
  it("ignores older requests and unmounted loads", () => {
    const requests = new RequestVersion();
    const old = requests.next(); const current = requests.next();
    expect(requests.current(old)).toBe(false); expect(requests.current(current)).toBe(true);
    requests.next(); expect(requests.current(current)).toBe(false);
  });
  it.each(["local", "pending", "synced", "credentials_required", "failed", null, "unexpected"])("maps only verified status %s", (status) => {
    expect(syncLabel(status)).toBe(status === "local" ? "localOnly" : status === "credentials_required" ? "credentialsRequired" : status === "pending" || status === "synced" ? status : "failed");
  });
  it("retains partial success and does not equate failed removal synchronization with synced", async () => {
    const result = await readComplianceResponse(Response.json({ ok: true, actionId: "action", syncStatus: "failed" }), "fallback");
    expect(result.ok).toBe(true); expect(syncLabel(result.syncStatus)).toBe("failed");
  });
  it("surfaces server conflict/error and marks ambiguous responses retryable", async () => {
    await expect(readComplianceResponse(Response.json({ error: "Review again", code: "changed" }, { status: 409 }), "fallback")).rejects.toMatchObject({ message: "Review again", code: "changed", uncertain: false });
    await expect(readComplianceResponse(new Response("upstream html", { status: 502 }), "fallback")).rejects.toMatchObject({ message: "fallback", uncertain: true });
    await expect(readComplianceResponse(new Response("not json", { status: 200 }), "fallback")).rejects.toBeInstanceOf(ComplianceClientError);
    await expect(readComplianceResponse(Response.json({ code: "forbidden" }, { status: 403 }), "fallback")).rejects.toMatchObject({ message: "fallback", uncertain: false });
  });
  it("accepts empty and unknown-score dashboards but rejects malformed evidence", () => {
    expect(isDashboard({ weekEnding: row.weekEnding, canManage: true, rows: [] })).toBe(true);
    const dashboard = { weekEnding: row.weekEnding, canManage: true, rows: [row] };
    expect(isDashboard(dashboard)).toBe(true);
    expect(isDashboard({ ...dashboard, rows: [{ ...row, score: null, evidenceState: "missing", outcome: "pending_data" }] })).toBe(true);
    expect(isDashboard({ ...dashboard, rows: [{ ...row, score: undefined }] })).toBe(false);
    expect(isDashboard({ ...dashboard, rows: [{ ...row, evidenceState: "guessed" }] })).toBe(false);
    expect(isDashboard({ ...dashboard, rows: [{ ...row, weekEnding: "2026-08-30" }] })).toBe(false);
  });
  it.each(["en-US", "pt-BR"])("renders daily values and immutable history in %s without weekly-pass or recommendation copy", (locale) => {
    const messages = locale === "pt-BR" ? pt : en;
    const render = (children: ReturnType<typeof jsx>) => renderToStaticMarkup(jsx(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: (error: Error) => { throw error; }, children }));
    const daily = render(jsx(ComplianceDailyEvidence, { row: { ...row, outcome: "passed" } }));
    expect(daily).toContain("<table");
    expect(daily).toContain(new Intl.NumberFormat(locale).format(7_200_000));
    expect(daily).toContain("0 /");
    expect(daily).toContain(messages.vsCompliance.missing);
    expect(daily).not.toContain(messages.vsCompliance.passed);
    const history = render(jsx(ComplianceHistoryRecords, { history: { eventId: row.id, memberId: row.memberId, memberName: row.memberName, weekEnding: row.weekEnding, actions: [{ id: "action", actorId: "private-actor-id", actorName: "Original Officer", kind: "demote", expectedRank: 3, targetRank: 2, reason: null, recordedAt: "2026-09-07T02:00:00.000Z", correctionReview: true, reviewDates: ["2026-09-08T02:00:00.000Z"], syncStatus: "local", supersededAt: null }] } }));
    expect(history).toContain("Original Officer");
    expect(history).not.toContain("private-actor-id");
    expect(history).toContain("R3"); expect(history).toContain("R2");
    expect(history).toContain(messages.vsCompliance.actionSaved);
    expect(history).not.toContain("Recommend");
    const otherActions = render(jsx(ComplianceHistoryRecords, { history: { eventId: row.id, memberId: row.memberId, memberName: row.memberName, weekEnding: row.weekEnding, actions: ["waive", "remove"].map((kind) => ({ id: kind, actorId: "original", actorName: "Officer", kind, expectedRank: 1, targetRank: null, reason: kind === "waive" ? "Private reason" : null, recordedAt: "2026-09-07T02:00:00.000Z", correctionReview: false, reviewDates: [], syncStatus: null, supersededAt: null })) } }));
    expect(otherActions).toContain(messages.vsCompliance.waived);
    expect(otherActions).toContain(messages.vsCompliance.waiverReason);
    expect(otherActions).toContain(messages.members.statusFormer);
    expect(otherActions).not.toContain("Recommend");
    expect(history).toContain(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Etc/GMT+2" }).format(new Date("2026-09-07T02:00:00.000Z")));
  });
  it("validates policy versions without accepting implicit enabled defaults", () => {
    const policy = { enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null, leewayPct: 0, preset: "rank_aware", removalThreshold: 3, version: 1, effectiveWeek: "2026-09-20" };
    expect(isPolicy(policy)).toBe(true);
    expect(isPolicy({ ...policy, enabled: true })).toBe(false);
    expect(isPolicy({ ...policy, effectiveWeek: "2026-09-21" })).toBe(false);
    expect(isPolicy({ ...policy, version: 0 })).toBe(false);
    expect(isMembershipSettings({ defaults: policy, history: [], latest: null, canManage: false })).toBe(true);
    expect(isMembershipSettings({ defaults: { enabled: true }, history: [], latest: null, canManage: true })).toBe(false);
  });
  it.each(["en-US", "pt-BR"])("renders evidence and numbers with the active %s catalog", (locale) => {
    const messages = locale === "pt-BR" ? pt : en;
    const render = (value: ComplianceRow) => renderToStaticMarkup(jsx(NextIntlClientProvider, { locale, messages, timeZone: "UTC", children: jsx(ComplianceEvidence, { row: value }) }));
    const html = render(row);
    expect(html).toContain(messages.vsCompliance.ready);
    expect(html).toContain(new Intl.NumberFormat(locale).format(row.threshold!));
    expect(html).toContain(messages.dashboard.details);
    expect(html).not.toContain("trains.paintRuleGate.ineligibleLocked");
    const unknown = render({ ...row, score: null, outcome: "pending_data", evidenceState: "partial", recommendation: { kind: "none", targetRank: null }, streak: null });
    expect(unknown).toContain(messages.vsCompliance.pendingHint);
    expect(unknown).toContain(messages.vsCompliance.partial);
    expect(unknown).not.toContain("0 points");
    const ineligible = render({ ...row, outcome: "not_eligible" });
    expect(ineligible).not.toContain("trains.paintRuleGate.ineligibleLocked");
  });
});
