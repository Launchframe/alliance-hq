import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { emptyBoard, fieldKey } from "./policy.shared";
import type { SupportTransaction } from "./repository.server";
import type { WorkRecipient } from "./work-routing.shared";

const mocks = vi.hoisted(() => ({ context: vi.fn(), conflicts: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...(await vi.importActual("@/lib/db")), getDb: mocks.db }));
vi.mock("server-only", () => ({}));
vi.mock("./work-context.server", () => ({ loadWorkContext: mocks.context }));
vi.mock("@/lib/time-off/coverage.server", () => ({ listCoverageConflictsTx: mocks.conflicts, professionCoverageDuties: vi.fn(async () => []), trainCoverageDuties: vi.fn(() => []) }));
import { loadTeamWorkDashboard, reconcileTeamWorkTx } from "./work-service.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { routeCoverageConflicts } from "@/lib/time-off/coverage-routing.server";
import { canReadTeamWorkInbox } from "./work-inbox.server";

const joinedAt = new Date("2020-01-01T00:00:00Z");
const coverageConflict = { memberId: "member", memberName: "Member", dutyDate: "2099-01-01", dutyRole: "conductor" as const, assignmentId: "train", assignmentVersion: "1", absenceVersion: "1", lockedAt: null };
const recipient = (id: string, memberIds: string[]): WorkRecipient => ({ id, memberIds, allianceId: "a", name: id, active: true, role: id === "owner" ? "owner" : "officer", permissions: ["trains:write", "time_off:write", "vs_compliance:manage"] });
const board = () => ({ ...emptyBoard("a"), published: true, fields: Object.fromEntries([
  [fieldKey("team", "team", "exists"), { value: true, version: 1, actionId: "original-actor-action" }],
  [fieldKey("team", "team", "name"), { value: "Team", version: 1, actionId: "original-actor-action" }],
  [fieldKey("team", "team", "lead"), { value: "lead-member", version: 1, actionId: "original-actor-action" }],
  [fieldKey("member", "member", "team"), { value: "team", version: 1, actionId: "original-actor-action" }],
]) });
function database() {
  const tables: Record<string, Record<string, unknown>[]> = {
    member_time_off: [{ id: "absence", memberId: "member", startDate: "2099-01-01", endDate: "2099-01-03", version: 1, createdAt: new Date(), globalAbsence: true, privateNotes: "private absence" }],
    member_alliance_tenure: [{ memberId: "member", joinedAt }],
    commander_alliance_memberships: [],
    vs_compliance_evaluations: [], vs_compliance_sync_jobs: [], team_work_items: [], team_work_digests: [], inbox_reminder_items: [], team_work_state: [],
  };
  const writes: string[] = [];
  const chain = (rows: unknown[]) => { const result = Object.assign(Promise.resolve(rows), { where: () => result, for: () => result, limit: () => result, innerJoin: () => result }); return result; };
  const tx = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => chain([...(tables[getTableName(table)] ?? [])]) }),
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (value: Record<string, unknown>) => {
      const name = getTableName(table);
      const apply = (set?: Record<string, unknown>) => {
        writes.push(name);
        const rows = tables[name] ??= [];
        const old = rows.find((row) => value.id ? row.id === value.id : row.allianceId === value.allianceId);
        if (!old) rows.push({ ...value }); else if (set) Object.assign(old, set);
        return Promise.resolve();
      };
      return { onConflictDoNothing: () => apply(), onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => apply(set) };
    } }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({ where: () => {
      const name = getTableName(table); writes.push(name);
      for (const row of tables[name] ?? []) Object.assign(row, value);
      return Promise.resolve();
    } }) }),
  } as unknown as SupportTransaction;
  mocks.db.mockReturnValue({ ...tx, transaction: (work: (connection: SupportTransaction) => unknown) => work(tx) });
  return { tables, tx, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ board: board(), roster: [{ id: "member", name: "Member" }, { id: "lead-member", name: "Lead", rank: 4 }], stints: { member: "stint", "lead-member": "lead-stint" }, recipients: [recipient("lead", ["lead-member"]), recipient("owner", [])] });
  mocks.conflicts.mockResolvedValue([]);
});

describe("durable team work source projection", () => {
  it("keeps stable source ownership, version and one daily digest across retries", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const first = await reconcileTeamWorkTx(db.tx, "a");
    const retry = await reconcileTeamWorkTx(db.tx, "a");
    expect(first.items).toHaveLength(1);
    expect(retry.items[0]).toEqual(first.items[0]);
    expect(db.tables.team_work_items).toHaveLength(1);
    expect(db.tables.team_work_digests).toHaveLength(1);
    expect(db.tables.inbox_reminder_items).toHaveLength(1);
    expect(first.items[0].assigneeId).toBe("lead");
  });
  it("reassigns unresolved ownership without editing original actions or actors", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const first = await reconcileTeamWorkTx(db.tx, "a");
    const context = await mocks.context();
    context.recipients[0].active = false;
    const next = await reconcileTeamWorkTx(db.tx, "a");
    expect(next.items[0]).toMatchObject({ id: first.items[0].id, assigneeId: "owner", version: 2 });
    expect(context.board.fields[fieldKey("member", "member", "team")].actionId).toBe("original-actor-action");
    expect(db.writes).not.toContain("vs_compliance_actions");
    expect(db.writes).not.toContain("support_team_events");
  });
  it("does not copy local notes or original audit actors into work or digests", async () => {
    const db = database();
    await reconcileTeamWorkTx(db.tx, "a");
    expect(JSON.stringify([db.tables.team_work_items, db.tables.team_work_digests, db.tables.inbox_reminder_items])).not.toContain("private absence");
  });
  it("closes a cancelled source without deleting the durable task", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    await reconcileTeamWorkTx(db.tx, "a");
    mocks.conflicts.mockResolvedValue([]);
    await reconcileTeamWorkTx(db.tx, "a");
    expect(db.tables.team_work_items).toHaveLength(1);
    expect(db.tables.team_work_items[0].open).toBe(false);
    expect(db.tables.inbox_reminder_items[0].active).toBe(0);
  });
  it("does not carry a departed member's old absence into a new membership stint", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    await reconcileTeamWorkTx(db.tx, "a");
    db.tables.member_alliance_tenure = [{ memberId: "member", joinedAt: new Date(Date.now() + 1000) }];
    expect((await reconcileTeamWorkTx(db.tx, "a")).items).toHaveLength(0);
  });
  it("keeps absence notices for coverage routing without generating informational items", async () => {
    const db = database();
    const result = await reconcileTeamWorkTx(db.tx, "a");
    expect(result.items).toHaveLength(0);
    expect(result.currentNotices).toHaveLength(1);
    expect(db.tables.team_work_items).toHaveLength(0);
    expect(db.tables.team_work_digests).toHaveLength(0);
  });
  it("closes a stale time off row during normal reconciliation", async () => {
    const db = database();
    db.tables.team_work_items = [{ id: "legacy", allianceId: "a", sourceKey: "legacy", sourceVersion: "1", kind: "time_off", memberId: "member", stint: "stint", teamId: "team", assigneeId: "lead", requiredPermission: "time_off:write", detail: {}, href: "/time-off", version: 1, open: true, createdAt: joinedAt, updatedAt: joinedAt }];
    await reconcileTeamWorkTx(db.tx, "a");
    expect(db.tables.team_work_items).toHaveLength(1);
    expect(db.tables.team_work_items[0].open).toBe(false);
    expect(db.tables.inbox_reminder_items[0].active).toBe(0);
  });
  it("routes Engineer coverage to an administrator rather than an unauthorized team lead", async () => {
    const db = database();
    const context = await mocks.context();
    context.recipients.find((recipient: WorkRecipient) => recipient.id === "owner").permissions.push("alliance:admin");
    const conflict = { memberId: "member", memberName: "Member", dutyDate: "2099-01-01", dutyRole: "engineer" as const, assignmentId: "shift", assignmentVersion: "1", absenceVersion: "1", lockedAt: null };
    mocks.conflicts.mockResolvedValue([conflict]);
    const work = (await reconcileTeamWorkTx(db.tx, "a")).items.find((item) => item.kind === "coverage");
    expect(work).toMatchObject({ requiredPermission: "alliance:admin", assigneeId: "owner" });
    expect((await routeCoverageConflicts("a", [conflict]))[0].routing?.hqUserId).toBe("owner");
  });

  it("consolidates multiple sources into one recipient digest", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict, { ...coverageConflict, dutyDate: "2099-01-02", assignmentId: "other-train" }]);
    expect((await reconcileTeamWorkTx(db.tx, "a")).items.map((item) => item.kind)).toEqual(["coverage", "coverage"]);
    expect(db.tables.team_work_digests).toHaveLength(1);
    expect(db.tables.inbox_reminder_items).toHaveLength(1);
  });
});

describe("durable inbox authorization", () => {
  it("requires current task grants and tenant ownership even with cached caller permissions", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const context = await mocks.context();
    const input = { allianceId: "a", hqUserId: "lead", permissions: new Set(["trains:write"]), personal: true };
    expect(await canReadTeamWorkInbox(input)).toBe(true);
    expect(await canReadTeamWorkInbox({ ...input, hqUserId: "other" })).toBe(false);
    expect(await canReadTeamWorkInbox({ ...input, allianceId: "foreign" })).toBe(false);
    expect(await canReadTeamWorkInbox({ ...input, permissions: new Set() })).toBe(false);
    context.recipients[0].permissions = [];
    expect(await canReadTeamWorkInbox(input)).toBe(false);
    context.recipients = [];
    expect(await canReadTeamWorkInbox(input)).toBe(false);
    expect(db.tables.team_work_items[0].assigneeId).toBeNull();
  });
  it("reconciles published ownership and current availability before personal inbox eligibility", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const context = await mocks.context();
    const input = { allianceId: "a", hqUserId: "lead", permissions: new Set(["trains:write"]), personal: true };
    expect(await canReadTeamWorkInbox(input)).toBe(true);
    context.board.fields[fieldKey("team", "team", "lead")].value = "owner-member";
    context.roster.push({ id: "owner-member", name: "Owner", rank: 5 });
    context.stints["owner-member"] = "owner-stint";
    context.recipients[1].memberIds = ["owner-member"];
    expect(await canReadTeamWorkInbox(input)).toBe(false);
    expect(await canReadTeamWorkInbox({ ...input, hqUserId: "owner" })).toBe(true);
    expect(db.tables.team_work_items[0]).toMatchObject({ assigneeId: "owner", version: 2 });
    db.tables.member_alliance_tenure.push({ memberId: "owner-member", joinedAt });
    db.tables.member_time_off.push({ id: "owner-absence", memberId: "owner-member", startDate: getServerCalendarDate(), endDate: getServerCalendarDate(), createdAt: new Date(), globalAbsence: true });
    expect(await canReadTeamWorkInbox({ ...input, hqUserId: "owner" })).toBe(false);
    expect(await canReadTeamWorkInbox(input)).toBe(true);
  });
});

describe("coverage routing integration", () => {
  it("uses current and duty-date availability consistently without earlier-stint absences", async () => {
    const db = database();
    const today = getServerCalendarDate();
    db.tables.member_alliance_tenure.push({ memberId: "lead-member", joinedAt });
    const conflict = { memberId: "member", memberName: "Member", dutyDate: "2099-01-01", dutyRole: "conductor" as const, assignmentId: "train", assignmentVersion: "1", absenceVersion: "1", lockedAt: null };
    db.tables.member_time_off.push({ memberId: "lead-member", startDate: today, endDate: today, createdAt: new Date("2019-01-01"), globalAbsence: true });
    expect((await routeCoverageConflicts("a", [conflict]))[0].routing?.hqUserId).toBe("lead");
    db.tables.member_time_off[1].createdAt = new Date();
    expect((await routeCoverageConflicts("a", [conflict]))[0].routing?.hqUserId).toBe("owner");
    db.tables.member_time_off[1].startDate = conflict.dutyDate;
    db.tables.member_time_off[1].endDate = conflict.dutyDate;
    mocks.conflicts.mockResolvedValue([conflict]);
    expect((await reconcileTeamWorkTx(db.tx, "a")).items.find((item) => item.kind === "coverage")?.assigneeId).toBe("owner");
  });
});

describe("team dashboard action projection", () => {
  const actor = { sessionId: "session", hqUserId: "lead", allianceId: "a" };
  async function dashboard(role = "member", published = true) {
    const db = database();
    db.tables.sessions = [{ userId: "lead", allianceId: "a", expiresAt: new Date("2099-01-01") }];
    db.tables.hq_users = [{ admin: 0 }];
    const context = await mocks.context();
    context.board.published = published;
    context.recipients[0].role = role;
    context.recipients[0].permissions = role === "member" ? ["members:read"] : ["members:read", "trains:write", "time_off:read", "vs_compliance:read", "vs_compliance:manage"];
    db.tables.member_alliance_tenure.push({ memberId: "lead-member", joinedAt });
    return db;
  }
  it("keeps the action queue and roster hidden from a member in a lead slot", async () => {
    await dashboard();
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.items).toEqual([]);
    expect(result.canReview).toBe(false);
    expect(result.teams).toHaveLength(1);
    expect(Object.keys(result).sort()).toEqual(["canReview", "items", "teams"]);
  });
  it("projects coverage and VS actions without member histories or private notes", async () => {
    const db = await dashboard("officer");
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.items.map((item) => item.kind)).toEqual(["coverage"]);
    expect(result.items[0].teamId).toBe("team");
    expect(result.canReview).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private absence|currentWeek|absences|duties|weeks|days|game_?uid/i);
    expect(db.tables.vs_score_heads ?? []).toEqual([]);
  });
  it("keeps private period time off out of team routing and the payload", async () => {
    const db = await dashboard("officer");
    db.tables.member_time_off = [{ id: "private-period", memberId: "lead-member", startDate: "2099-01-01", endDate: "2099-01-02", globalAbsence: false, createdAt: new Date(), notes: "private period note" }];
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.items).toEqual([]);
    expect(db.tables.team_work_items).toEqual([]);
    expect(db.tables.team_work_digests).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private period note");
  });
  it("does not reveal unpublished team routing to members", async () => {
    await dashboard("member", false);
    const result = await loadTeamWorkDashboard(actor);
    expect(result.teams).toEqual([]);
    expect(result.items).toEqual([]);
  });
  it("hides team context on actions while the board is unpublished", async () => {
    await dashboard("officer", false);
    mocks.conflicts.mockResolvedValue([coverageConflict]);
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.teams).toEqual([]);
    expect(result.items[0]).toMatchObject({ kind: "coverage", teamId: null, leadName: null, leadAway: false });
  });
});
