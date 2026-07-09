import { beforeEach, describe, expect, it, vi } from "vitest";

import { findAdoptableHqAllianceShell } from "@/lib/rbac/sync-ashed-roles-shell.server";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    alliances: {
      id: "id",
      tag: "tag",
      ashedAllianceId: "ashedAllianceId",
    },
    allianceMemberships: {
      id: "id",
      hqUserId: "hqUserId",
      allianceId: "allianceId",
      status: "status",
    },
  },
}));

type ShellRow = {
  id: string;
  tag: string;
  ashedAllianceId: string | null;
  name: string;
  slug: string;
};

function shellRow(
  overrides: Partial<ShellRow> & Pick<ShellRow, "id" | "tag">,
): ShellRow {
  return {
    ashedAllianceId: null,
    name: overrides.tag,
    slug: overrides.tag.toLowerCase(),
    ...overrides,
  };
}

function mockSelectById(row: ShellRow | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return () => ({ from });
}

function mockSelectCandidates(rows: ShellRow[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  return () => ({ from });
}

function mockSelectMembership(hasMembership: boolean) {
  const limit = vi.fn().mockResolvedValue(hasMembership ? [{ id: "mem-1" }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return () => ({ from });
}

function mockDbSelectSequence(
  handlers: Array<() => { from: ReturnType<typeof vi.fn> }>,
) {
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    const handler = handlers[call];
    if (!handler) {
      throw new Error(`Unexpected select call #${call + 1}`);
    }
    call += 1;
    return handler();
  });
  return select;
}

describe("findAdoptableHqAllianceShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the preferred shell when it is unlinked, tag-matched, and the user has membership", async () => {
    const preferred = shellRow({ id: "shell-prefer", tag: " ROAR " });
    const select = mockDbSelectSequence([
      mockSelectById(preferred),
      mockSelectMembership(true),
    ]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
        preferHqAllianceId: "shell-prefer",
        authHqUserId: "user-1",
      }),
    ).resolves.toBe(preferred);

    expect(select).toHaveBeenCalledTimes(2);
  });

  it("rejects a preferred shell when tags differ and falls back to a single tag match", async () => {
    const preferred = shellRow({ id: "shell-wrong-tag", tag: "LFgo" });
    const fallback = shellRow({ id: "shell-roar", tag: "roar" });
    const select = mockDbSelectSequence([
      mockSelectById(preferred),
      mockSelectCandidates([fallback]),
      mockSelectMembership(true),
    ]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
        preferHqAllianceId: "shell-wrong-tag",
        authHqUserId: "user-1",
      }),
    ).resolves.toBe(fallback);

    expect(select).toHaveBeenCalledTimes(3);
  });

  it("returns null when the preferred shell lacks membership for the auth user", async () => {
    const preferred = shellRow({ id: "shell-prefer", tag: "roar" });
    const select = mockDbSelectSequence([
      mockSelectById(preferred),
      mockSelectMembership(false),
      mockSelectCandidates([]),
    ]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
        preferHqAllianceId: "shell-prefer",
        authHqUserId: "user-1",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when multiple unlinked shells share the same tag", async () => {
    const select = mockDbSelectSequence([
      mockSelectCandidates([
        shellRow({ id: "shell-a", tag: "roar" }),
        shellRow({ id: "shell-b", tag: "roar" }),
      ]),
    ]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
        authHqUserId: "user-1",
      }),
    ).resolves.toBeNull();
  });

  it("returns the sole tag match when no auth user is provided", async () => {
    const candidate = shellRow({ id: "shell-only", tag: "roar" });
    const select = mockDbSelectSequence([mockSelectCandidates([candidate])]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
      }),
    ).resolves.toBe(candidate);

    expect(select).toHaveBeenCalledTimes(1);
  });

  it("returns null when the sole tag match lacks membership for the auth user", async () => {
    const candidate = shellRow({ id: "shell-only", tag: "roar" });
    const select = mockDbSelectSequence([
      mockSelectCandidates([candidate]),
      mockSelectMembership(false),
    ]);

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      findAdoptableHqAllianceShell({
        ashedTag: "roar",
        authHqUserId: "user-1",
      }),
    ).resolves.toBeNull();
  });
});
