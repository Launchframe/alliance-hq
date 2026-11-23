import { afterEach, describe, expect, it, vi } from "vitest";

const advisoryLock = vi.fn(async () => undefined);
const advisoryUnlock = vi.fn(async () => undefined);
const end = vi.fn(async () => undefined);

vi.mock("@/lib/db/url", () => ({
  getDatabaseUrl: () => "postgres://e2e:e2e@127.0.0.1:5432/alliance_hq_e2e",
}));

vi.mock("@/lib/db/postgres-client", () => ({
  postgresClientOptions: () => ({}),
}));

vi.mock("postgres", () => {
  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("pg_advisory_lock")) {
        await advisoryLock();
        return [];
      }
      if (text.includes("pg_advisory_unlock")) {
        await advisoryUnlock();
        return [];
      }
      return [];
    },
    { end },
  );
  return { default: () => sql };
});

describe("withGameUidClaimLock re-entrancy", () => {
  afterEach(() => {
    advisoryLock.mockClear();
    advisoryUnlock.mockClear();
    end.mockClear();
  });

  it("acquires once when nested for the same UID (HQ→Discord inherit)", async () => {
    const { withGameUidClaimLock } = await import(
      "./game-uid-global-claim.server"
    );
    const uid = "1234567890121204";
    let nestedRan = false;

    await withGameUidClaimLock(uid, async () => {
      await withGameUidClaimLock(uid, async () => {
        nestedRan = true;
      });
    });

    expect(nestedRan).toBe(true);
    expect(advisoryLock).toHaveBeenCalledTimes(1);
    expect(advisoryUnlock).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("acquires separately for different UIDs", async () => {
    const { withGameUidClaimLock } = await import(
      "./game-uid-global-claim.server"
    );

    await withGameUidClaimLock("1234567890121204", async () => {
      await withGameUidClaimLock("1234567890121205", async () => undefined);
    });

    expect(advisoryLock).toHaveBeenCalledTimes(2);
    expect(advisoryUnlock).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });
});
