import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { getServerCalendarDate } from "@/lib/trains/game-time";

const mocks = vi.hoisted(() => ({ db: vi.fn(), reconcile: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ ...(await vi.importActual("@/lib/db")), getDb: mocks.db }));
vi.mock("./work-service.server", () => ({ reconcileTeamWork: mocks.reconcile, reconcileTeamWorkTx: mocks.reconcile }));
vi.mock("./work-transport.server", () => ({ sendPrivateWorkDigest: mocks.send }));
import { deliverTeamWorkDigests } from "./work-outbox.server";

function database(status = "pending") {
  const digest: Record<string, unknown> = { id: "stable-digest", allianceId: "a", recipientId: "lead", day: getServerCalendarDate(), status, attempts: 0, nextAttemptAt: new Date(0), leaseUntil: new Date(0), leaseToken: null };
  const tables: Record<string, Record<string, unknown>[]> = { team_work_digests: [digest], discord_hq_links: [{ discordUserId: "discord-lead" }], discord_user_prefs: [{ locale: "pt-BR" }] };
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const chain = (rows: unknown[]) => { const query = Object.assign(Promise.resolve(structuredClone(rows)), { where: () => query, for: () => query, orderBy: () => query, limit: () => query }); return query; };
  const tx = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => chain(tables[getTableName(table)] ?? []) }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({ where: () => { const name = getTableName(table); writes.push({ table: name, value }); Object.assign(tables[name][0], value); return Promise.resolve(); } }) }),
  };
  mocks.db.mockReturnValue({ ...tx, transaction: (work: (tx: unknown) => unknown) => work(tx) });
  return { digest, tables, writes };
}
const context = () => ({ recipients: [{ id: "lead", allianceId: "a", active: true, role: "officer", permissions: ["trains:write"], memberIds: ["member"], name: "Lead" }], items: [{ id: "task", allianceId: "a", assigneeId: "lead", requiredPermission: "trains:write" }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
  mocks.reconcile.mockResolvedValue(context());
  mocks.send.mockImplementation(async (input) => await input.authorizeSend("dm") ? { status: "sent", messageId: "message", channelId: "dm" } : { status: "cancelled" });
});
afterEach(() => vi.unstubAllEnvs());

describe("durable team digest lease and authorization", () => {
  it("checks recipient ownership again before posting and localizes a content-free private summary", async () => {
    const db = database();
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 1 });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(db.writes.map((write) => write.value.status)).toEqual(["leased", "posting", "sent"]);
    expect(mocks.send.mock.calls[0][0].content).toContain("Resumo do trabalho em equipe");
    expect(mocks.send.mock.calls[0][0].content).not.toContain("member");
    expect(db.writes.every((write) => write.table === "team_work_digests")).toBe(true);
  });
  it("does not deliver after reassignment during DM channel creation", async () => {
    const db = database();
    const reassigned = context(); reassigned.items[0].assigneeId = "owner";
    mocks.reconcile.mockResolvedValueOnce(context()).mockResolvedValueOnce(reassigned);
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 0 });
    expect(db.writes.some((write) => write.value.status === "posting")).toBe(false);
    expect(db.digest.status).toBe("cancelled");
  });
  it("rejects revoked task authorization even when the assignee did not change", async () => {
    const db = database();
    const revoked = context(); revoked.recipients[0].permissions = [];
    mocks.reconcile.mockResolvedValue(revoked);
    await deliverTeamWorkDigests();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.digest.status).toBe("cancelled");
  });
  it("rechecks role eligibility after channel creation even if cached grants remain", async () => {
    const db = database();
    const revoked = context(); revoked.recipients[0].role = "member";
    mocks.reconcile.mockResolvedValueOnce(context()).mockResolvedValueOnce(revoked);
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 0 });
    expect(db.writes.some((write) => write.value.status === "posting")).toBe(false);
    expect(db.digest.status).toBe("cancelled");
  });
  it("does not post to an identity relinked while the DM channel was opening", async () => {
    const db = database();
    mocks.send.mockImplementation(async (input) => {
      db.tables.discord_hq_links = [{ discordUserId: "replacement-discord" }];
      expect(await input.authorizeSend("old-dm")).toBe(false);
      return { status: "cancelled" };
    });
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 0 });
    expect(db.writes.some((write) => write.value.status === "posting")).toBe(false);
  });
  it("rejects a superseded preparation lease before any private message POST", async () => {
    const db = database();
    mocks.send.mockImplementation(async (input) => {
      db.digest.leaseToken = "another-worker";
      expect(await input.authorizeSend("dm")).toBe(false);
      return { status: "cancelled" };
    });
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 0 });
    expect(db.writes.some((write) => write.value.status === "posting")).toBe(false);
  });
  it("retains missing-link tasks and retries delivery later", async () => {
    const db = database(); db.tables.discord_hq_links = [];
    await deliverTeamWorkDigests();
    expect(db.digest.status).toBe("pending");
    expect(db.digest.lastError).toBe("recipient_unlinked");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.writes.every((write) => write.table === "team_work_digests")).toBe(true);
  });
  it("retains crash-after-POST leases as uncertain instead of claiming exactly-once delivery", async () => {
    const db = database("posting");
    await deliverTeamWorkDigests();
    expect(db.digest.status).toBe("uncertain");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("recovers an expired preparation lease before any message POST", async () => {
    const db = database("leased");
    await deliverTeamWorkDigests();
    expect(db.digest.status).toBe("sent");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("does not send another digest on repeated delivery ticks after success", async () => {
    database();
    await deliverTeamWorkDigests();
    await deliverTeamWorkDigests();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("backs off explicit rejection but stops ambiguous message retries", async () => {
    const db = database();
    mocks.send.mockResolvedValueOnce({ status: "pending" });
    await deliverTeamWorkDigests();
    expect(db.digest.status).toBe("pending");
    await deliverTeamWorkDigests();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    db.digest.nextAttemptAt = new Date(0);
    mocks.send.mockResolvedValueOnce({ status: "uncertain" });
    await deliverTeamWorkDigests();
    await deliverTeamWorkDigests();
    expect(db.digest.status).toBe("uncertain");
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it("does not touch delivery storage without a configured bot", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    expect(await deliverTeamWorkDigests()).toEqual({ delivered: 0 });
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("never retries sent or uncertain digests", async () => {
    for (const status of ["sent", "uncertain"]) {
      const db = database(status);
      await deliverTeamWorkDigests();
      expect(db.digest.status).toBe(status);
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
