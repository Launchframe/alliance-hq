import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: mocks.select,
      insert: mocks.insert,
      update: mocks.update,
    }),
  };
});

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(),
}));

import { bindGuildAllianceForRegistration } from "@/lib/vr/repository";

function mockGuildAllianceSelect(allianceId: string | null) {
  mocks.select.mockReturnValueOnce({ from: mocks.from });
  mocks.from.mockReturnValueOnce({ where: mocks.where });
  mocks.where.mockReturnValueOnce({ limit: mocks.limit });
  mocks.limit.mockResolvedValueOnce(allianceId ? [{ allianceId }] : []);
}

function mockInsertReturning(rows: Array<{ guildId: string }>) {
  mocks.insert.mockReturnValueOnce({ values: mocks.values });
  mocks.values.mockReturnValueOnce({
    onConflictDoNothing: mocks.onConflictDoNothing,
  });
  mocks.onConflictDoNothing.mockReturnValueOnce({
    returning: mocks.returning,
  });
  mocks.returning.mockResolvedValueOnce(rows);
}

describe("bindGuildAllianceForRegistration CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts when the guild is unbound", async () => {
    mockGuildAllianceSelect(null);
    mockInsertReturning([{ guildId: "g1" }]);

    await expect(
      bindGuildAllianceForRegistration({
        guildId: "g1",
        allianceId: "alliance-a",
        discordUserId: "discord-1",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("fails closed when a concurrent binder wins the unbound insert race", async () => {
    // First read: unbound
    mockGuildAllianceSelect(null);
    // Insert loses (conflict → no returning row)
    mockInsertReturning([]);
    // Re-read: other alliance won
    mockGuildAllianceSelect("alliance-b");

    await expect(
      bindGuildAllianceForRegistration({
        guildId: "g1",
        allianceId: "alliance-a",
        discordUserId: "discord-1",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "guild_bound_to_other_alliance",
    });

    expect(mocks.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("treats same-alliance insert conflict as success (idempotent race)", async () => {
    mockGuildAllianceSelect(null);
    mockInsertReturning([]);
    mockGuildAllianceSelect("alliance-a");

    await expect(
      bindGuildAllianceForRegistration({
        guildId: "g1",
        allianceId: "alliance-a",
        discordUserId: "discord-1",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("no-ops when already bound to the requested alliance", async () => {
    mockGuildAllianceSelect("alliance-a");

    await expect(
      bindGuildAllianceForRegistration({
        guildId: "g1",
        allianceId: "alliance-a",
        discordUserId: "discord-1",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not use blind onConflictDoUpdate in the bind path", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/vr/repository.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "export async function bindGuildAllianceForRegistration",
    );
    const end = source.indexOf(
      "\nexport async function",
      start + "export async function bindGuildAllianceForRegistration".length,
    );
    const bindBody = source.slice(start, end === -1 ? undefined : end);

    expect(bindBody).toContain("onConflictDoNothing()");
    expect(bindBody).not.toContain("upsertGuildAlliance(");
    // Blind conflict-update must not appear as a call (comments may mention it).
    expect(bindBody).not.toMatch(/\.onConflictDoUpdate\s*\(/);
  });
});
