import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/postgres-client", () => ({
  postgresClientOptions: () => ({
    prepare: false,
    max: 5,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
    connect_timeout: 10,
  }),
}));

vi.mock("@/lib/db/url", () => ({
  getDatabaseUrl: () => "postgres://example.invalid/db",
}));

describe("ashedScoreReplaceLockClientOptions", () => {
  it("keeps the lock session alive across idle Ashed HTTP", async () => {
    const { ashedScoreReplaceLockClientOptions } = await import(
      "./ashed-score-replace-lock.server"
    );
    const options = ashedScoreReplaceLockClientOptions();
    expect(options.idle_timeout).toBe(0);
    expect(options.max_lifetime).toBeGreaterThanOrEqual(60 * 10);
    expect(options.max).toBe(1);
  });
});
