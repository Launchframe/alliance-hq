import { describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import { countCompletedDeviceLinksByHqUser } from "./device-link-stats";

describe("countCompletedDeviceLinksByHqUser", () => {
  it("returns counts keyed by HQ user id", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { hqUserId: "hq-1", count: 2 },
      { hqUserId: "hq-2", count: 1 },
    ]);
    const where = vi.fn().mockReturnValue({ groupBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const counts = await countCompletedDeviceLinksByHqUser();

    expect(counts.get("hq-1")).toBe(2);
    expect(counts.get("hq-2")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("returns empty map when no active linked devices", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ groupBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const counts = await countCompletedDeviceLinksByHqUser();
    expect(counts.size).toBe(0);
  });
});
