import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { defaultVsPolicy } from "./policy.shared";
import type { ComplianceTx, loadComplianceFacts } from "./evidence.server";

const mockFacts = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("./evidence.server", async () => ({ ...(await vi.importActual("./evidence.server")), loadComplianceFacts: mockFacts }));
import { rebuildComplianceTx, type ComplianceRow } from "./repository.server";

const weeks = ["2026-08-16", "2026-08-23", "2026-08-30"];
const member = { active: true, currentRank: 3, rankVersion: "rank", joinedAt: "2020-01-01T00:00:00Z", leftAt: null, isOwner: false };
function facts(): Awaited<ReturnType<typeof loadComplianceFacts>> {
  return { alliance: { operatingMode: "native" }, policies: [{ ...defaultVsPolicy(), enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", effectiveWeek: weeks[0], version: 1 }], members: [{ memberId: "member", name: "Member", member }], heads: weeks.map((date, index) => ({ id: `head-${index}`, memberId: "member", recordedDate: date, period: "weekly", origin: "hq", version: 1, score: 1 })), scopes: [], entries: [], revisions: [] } as unknown as Awaited<ReturnType<typeof loadComplianceFacts>>;
}
function database(previous: ComplianceRow[] = [], actions: unknown[] = [], jobs: unknown[] = []) {
  const results = [previous, actions, jobs];
  const writes: { table: string; value: Record<string, unknown> }[] = [];
  const chain = (rows: unknown[]) => { const value = Object.assign(Promise.resolve(rows), { from: () => value, where: () => value, onConflictDoNothing: () => value, onConflictDoUpdate: () => value }); return value; };
  return { writes, tx: { select: () => chain(results.shift() ?? []), insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (value: Record<string, unknown> | Record<string, unknown>[]) => { for (const row of Array.isArray(value) ? value : [value]) writes.push({ table: getTableName(table), value: row }); return chain([]); } }), update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => { writes.push({ table: getTableName(table), value }); return chain([]); } }) } as unknown as ComplianceTx };
}
const external = { native: true, verifiedAt: null, weeks: new Map(), excuses: [] };
beforeEach(() => { vi.clearAllMocks(); mockFacts.mockResolvedValue(facts()); });

describe("durable chronological evaluation and inbox reconciliation", () => {
  it("keeps every member/week outcome but exposes only one actionable member recommendation", async () => {
    const db = database();
    const result = await rebuildComplianceTx(db.tx, "tenant", weeks, external);
    expect(result.rows.map((row) => row.evaluation.streak)).toEqual([1, 2, 3]);
    expect(result.rows.map((row) => row.evaluation.recommendation.kind)).toEqual(["none", "none", "remove"]);
    expect(result.rows[2].evaluation.confirmationBasis).toMatch(/^[a-f0-9]{64}$/);
    expect(db.writes.filter((write) => write.table === "inbox_reminder_items").at(-1)?.value).toMatchObject({ active: 1, requiredPermission: "vs_compliance:read", body: null });
  });
  it("replays all evaluation and inbox upserts with stable identities, repairing missing inbox work", async () => {
    const first = await rebuildComplianceTx(database().tx, "tenant", weeks, external);
    const retryDb = database(first.rows);
    const retry = await rebuildComplianceTx(retryDb.tx, "tenant", weeks, external);
    expect(retry.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
    expect(retryDb.writes.filter((write) => write.table === "inbox_reminder_items")).toHaveLength(2);
  });
  it("rebuilds later recommendations from a persisted waiver instead of keeping an old removal task", async () => {
    const first = await rebuildComplianceTx(database().tx, "tenant", weeks, external);
    const waived = await rebuildComplianceTx(database(first.rows, [{ eventId: first.rows[1].id, memberId: "member", kind: "waive" }]).tx, "tenant", weeks, external);
    expect(waived.rows[2].evaluation).toMatchObject({ streak: 1, recommendation: { kind: "demote", targetRank: 2 } });
    expect(waived.rows[2].evaluation.confirmationBasis).not.toBe(first.rows[2].evaluation.confirmationBasis);
  });
  it("does not flag a confirmed departure itself as a score correction, but does audit a later correction", async () => {
    const first = await rebuildComplianceTx(database().tx, "tenant", weeks, external);
    const settled = { id: "action", eventId: first.rows[2].id, memberId: "member", kind: "remove", targetRank: null, memberSnapshot: member, evaluationBasis: first.rows[2].evaluation.evaluationBasis };
    const departed = facts(); departed.members[0].member = { ...member, active: false, joinedAt: null };
    mockFacts.mockResolvedValue(departed);
    const unchanged = await rebuildComplianceTx(database(first.rows, [settled]).tx, "tenant", weeks, external);
    expect(unchanged.rows[2].evaluation).toMatchObject({ correctionReview: false, recommendation: { kind: "none" } });
    departed.heads[2].score = 40_000_000; departed.heads[2].version++;
    const db = database(unchanged.rows, [settled]);
    const corrected = await rebuildComplianceTx(db.tx, "tenant", weeks, external);
    expect(corrected.rows[2].evaluation).toMatchObject({ outcome: "passed", correctionReview: true, recommendation: { kind: "none" } });
    expect(db.writes.some((write) => write.table === "vs_compliance_reviews")).toBe(true);
    expect(db.writes.some((write) => write.table === "member_violations" && write.value.expungedAt)).toBe(true);
    expect(db.writes.some((write) => write.table === "alliance_members")).toBe(false);
  });
  it("keeps failed optional synchronization visible after recommendations are settled", async () => {
    const first = await rebuildComplianceTx(database().tx, "tenant", weeks, external);
    const settled = { id: "action", eventId: first.rows[2].id, memberId: "member", kind: "remove", targetRank: null, memberSnapshot: member, evaluationBasis: first.rows[2].evaluation.evaluationBasis };
    const db = database(first.rows, [settled], [{ actionId: "action", memberId: "member", status: "failed" }]);
    await rebuildComplianceTx(db.tx, "tenant", weeks, external);
    expect(db.writes.filter((write) => write.table === "inbox_reminder_items").at(-1)?.value.active).toBe(1);
  });
});
