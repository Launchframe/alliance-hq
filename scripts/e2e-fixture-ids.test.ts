import { afterEach, describe, expect, it, vi } from "vitest";
import { createHqMemberLink, type Sql } from "../e2e/fixtures/db";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parallel member-link fixture identities", () => {
  it("does not collide when the clock and Math.random are identical", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const sql = vi.fn().mockResolvedValue([]) as unknown as Sql;
    const ids: string[] = [];
    for (let index = 0; index < 100; index++) {
      const result = await createHqMemberLink(sql, { allianceId: "fixture-alliance", hqUserId: `fixture-user-${index}` });
      expect(result.gameUid).toMatch(/^\d{16}$/);
      ids.push(result.gameUid);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves an explicit synthetic UID", async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as Sql;
    const result = await createHqMemberLink(sql, { allianceId: "fixture-alliance", hqUserId: "fixture-user", gameUid: "123456789012" });
    expect(result.gameUid).toBe("123456789012");
  });
});
