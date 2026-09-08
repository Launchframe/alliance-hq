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
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { vsWeekEndingDate } from "@/lib/vs-scores/evidence.shared";
import { routeCoverageConflicts } from "@/lib/time-off/coverage-routing.server";
import { canReadTeamWorkInbox } from "./work-inbox.server";

const joinedAt = new Date("2020-01-01T00:00:00Z");
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
    await reconcileTeamWorkTx(db.tx, "a");
    db.tables.member_time_off = [];
    await reconcileTeamWorkTx(db.tx, "a");
    expect(db.tables.team_work_items).toHaveLength(1);
    expect(db.tables.team_work_items[0].open).toBe(false);
    expect(db.tables.inbox_reminder_items[0].active).toBe(0);
  });
  it("does not carry a departed member's old absence into a new membership stint", async () => {
    const db = database();
    await reconcileTeamWorkTx(db.tx, "a");
    db.tables.member_alliance_tenure = [{ memberId: "member", joinedAt: new Date(Date.now() + 1000) }];
    expect((await reconcileTeamWorkTx(db.tx, "a")).items).toHaveLength(0);
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

  it("consolidates multiple source kinds into one recipient digest", async () => {
    const db = database();
    mocks.conflicts.mockResolvedValue([{ memberId: "member", dutyDate: "2099-01-01", dutyRole: "conductor", assignmentId: "train", assignmentVersion: "1", absenceVersion: "1" }]);
    expect((await reconcileTeamWorkTx(db.tx, "a")).items.map((item) => item.kind)).toEqual(["time_off", "coverage"]);
    expect(db.tables.team_work_digests).toHaveLength(1);
    expect(db.tables.inbox_reminder_items).toHaveLength(1);
  });
});

describe("durable inbox authorization", () => {
  it("requires current task grants and tenant ownership even with cached caller permissions", async () => {
    const db = database();
    db.tables.alliance_memberships = [{ role: "officer", roleId: "officer-role" }];
    db.tables.role_permissions = [{ permission: "trains:write" }];
    db.tables.team_work_items = [{ allianceId: "a", assigneeId: "lead", requiredPermission: "trains:write" }];
    const input = { allianceId: "a", hqUserId: "lead", permissions: new Set(["trains:write"]), personal: true };
    expect(await canReadTeamWorkInbox(input)).toBe(true);
    expect(await canReadTeamWorkInbox({ ...input, hqUserId: "other" })).toBe(false);
    expect(await canReadTeamWorkInbox({ ...input, allianceId: "foreign" })).toBe(false);
    expect(await canReadTeamWorkInbox({ ...input, permissions: new Set() })).toBe(false);
    db.tables.role_permissions = [];
    expect(await canReadTeamWorkInbox(input)).toBe(false);
    db.tables.alliance_memberships = [];
    expect(await canReadTeamWorkInbox(input)).toBe(false);
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

describe("team dashboard private projection", () => {
  const actor = { sessionId: "session", hqUserId: "lead", allianceId: "a" };
  async function dashboard(role = "member", published = true) {
    const db = database();
    db.tables.sessions = [{ userId: "lead", allianceId: "a", expiresAt: new Date("2099-01-01") }];
    db.tables.hq_users = [{ admin: 0 }];
    const context = await mocks.context();
    context.board.published = published;
    context.recipients[0].role = role;
    context.recipients[0].permissions = ["members:read"];
    db.tables.member_alliance_tenure.push({ memberId: "lead-member", joinedAt });
    return db;
  }
  it("does not expose the roster to a member merely because they occupy a lead slot", async () => {
    await dashboard();
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.members.map((member) => member.id)).toEqual(["lead-member"]);
    expect(result.items).toEqual([]);
    expect(result.canReview).toBe(false);
    expect(result.teams).toHaveLength(1);
  });
  it("keeps private period time off in its owner's view and out of team routing", async () => {
    const db = await dashboard();
    db.tables.member_time_off = [{ id: "private-period", memberId: "lead-member", startDate: "2099-01-01", endDate: "2099-01-02", globalAbsence: false, createdAt: new Date(), notes: "private period note" }];
    const result = await loadTeamWorkDashboard(actor, { personal: false });
    expect(result.members[0].absences).toHaveLength(1);
    expect(result.items).toEqual([]);
    expect(db.tables.team_work_items).toEqual([]);
    expect(db.tables.team_work_digests).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private period note");
    const context = await mocks.context();
    context.recipients[0].memberIds = [];
    context.recipients[0].role = "officer";
    context.recipients[0].permissions.push("time_off:read");
    expect((await loadTeamWorkDashboard(actor, { personal: false })).members.flatMap((member) => member.absences)).toEqual([]);
  });
  it("does not reveal unpublished contacts to members", async () => {
    await dashboard("member", false);
    const result = await loadTeamWorkDashboard(actor);
    expect(result.teams).toEqual([]);
    expect(result.members[0].teamId).toBeNull();
  });
  it("distinguishes explicit zero, missing daily data and canonical derived Saturday", async () => {
    const db = await dashboard();
    const week = vsWeekEndingDate(getServerCalendarDate());
    db.tables.vs_score_heads = [{ id: "zero", memberId: "lead-member", recordedDate: addCalendarDays(week, -6), period: "daily", origin: "hq", score: 0, updatedAt: new Date() }];
    const partial = (await loadTeamWorkDashboard(actor)).members[0].currentWeek!;
    expect(partial.evidenceState).toBe("partial");
    expect(partial.score).toBeNull();
    expect(partial.days[0]).toMatchObject({ evidenceState: "ready", score: 0 });
    expect(partial.days[1]).toMatchObject({ evidenceState: "missing", score: null });
    db.tables.vs_score_heads = [
      ...Array.from({ length: 5 }, (_, index) => ({ id: String(index), memberId: "lead-member", recordedDate: addCalendarDays(week, index - 6), period: "daily", origin: "hq", score: 1, updatedAt: new Date() })),
      { id: "weekly", memberId: "lead-member", recordedDate: week, period: "weekly", origin: "hq", score: 9, updatedAt: new Date() },
    ];
    const ready = (await loadTeamWorkDashboard(actor)).members[0].currentWeek!;
    expect(ready).toMatchObject({ evidenceState: "ready", score: 9, dailyCoverage: 5 });
    expect(ready.days[5]).toMatchObject({ evidenceState: "ready", score: 4 });
  });
  it("does not inherit earlier-stint score heads after rejoining", async () => {
    const db = await dashboard();
    const week = vsWeekEndingDate(getServerCalendarDate());
    db.tables.member_alliance_tenure = [{ memberId: "lead-member", joinedAt: new Date() }];
    db.tables.vs_score_heads = [{ id: "old", memberId: "lead-member", recordedDate: week, period: "weekly", origin: "hq", score: 42, updatedAt: joinedAt }];
    expect((await loadTeamWorkDashboard(actor)).members[0].currentWeek).toMatchObject({ evidenceState: "missing", score: null });
  });
});
