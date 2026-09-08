import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DiscordInteractionPayload } from "@/lib/discord/interactions";

const mocks = vi.hoisted(() => ({ allowed: vi.fn(), draft: vi.fn(), lock: vi.fn(), where: vi.fn(), state: { value: null as unknown } }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => ({ select: () => ({ from: () => ({ where: (query: unknown) => { mocks.where(query); return { limit: async () => mocks.state.value ? [{ state: mocks.state.value }] : [] }; } }) }) }) }));
vi.mock("@/lib/trains/discord-bot-auth.server", () => ({ callerCanManageTrains: mocks.allowed }));
vi.mock("@/lib/trains/discord-bot.server", () => ({ draftConductorForAlliance: mocks.draft, lockTrainAndAnnounce: mocks.lock }));
vi.mock("@/lib/trains/train-ownership.server", () => ({ resolveDiscordHqUserId: async () => "officer" }));
vi.mock("@/lib/vr/service", () => ({ resolveAllianceForGuild: async () => "alliance" }));
vi.mock("@/lib/vr/repository", () => ({ getDiscordUserLocale: async () => "pt-BR" }));
import { handleDiscordCoverage } from "./discord-coverage.server";

const token = "123456789012345678901";
const payload = { type: 5, guild_id: "guild", member: { user: { id: "actor" } }, data: { custom_id: `coverage:${token}`, components: [{ components: [{ custom_id: "note", value: "Confirmed coverage" }] }] } } as DiscordInteractionPayload;
const state = { kind: "train_coverage", action: "pick", memberId: "member", memberName: "Commander", date: "2099-09-10", conflicts: [] };

beforeEach(() => { vi.clearAllMocks(); mocks.allowed.mockResolvedValue(true); mocks.state.value = state; });
describe("private Discord coverage interactions", () => {
  it("reauthorizes modal submission and does not read state or mutate for a revoked officer", async () => {
    mocks.allowed.mockResolvedValue(false);
    const reply = await (await handleDiscordCoverage(payload)).json();
    expect(reply.data.flags).toBe(64);
    expect(mocks.where).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("binds stored confirmation to guild, tenant, actor and expiry before assigning", async () => {
    const reply = await (await handleDiscordCoverage(payload)).json();
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(query.params).toEqual([token, "alliance", "guild", "actor", expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)]);
    expect(reply.data.flags).toBe(64);
    expect(reply.data.allowed_mentions).toEqual({ parse: [] });
    expect(mocks.allowed).toHaveBeenCalledTimes(2);
    expect(mocks.draft).toHaveBeenCalledWith(expect.objectContaining({ allianceId: "alliance", memberId: "member", date: "2099-09-10" }));
    expect(reply.data.content).not.toContain("coverage:");
  });
  it("rejects expired or foreign interaction state", async () => {
    mocks.state.value = null;
    await handleDiscordCoverage(payload);
    expect(mocks.draft).not.toHaveBeenCalled();
    mocks.state.value = { kind: "entry" };
    await handleDiscordCoverage(payload);
    expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("shows the approved localized audit-note modal without executing a duty", async () => {
    const reply = await (await handleDiscordCoverage({ ...payload, type: 3 })).json();
    expect(reply.type).toBe(9);
    expect(reply.data.title).toBe("Manter atribuição");
    expect(reply.data.components[0].components[0].label).toBe("Nota de auditoria");
    expect(mocks.draft).not.toHaveBeenCalled();
  });
});
