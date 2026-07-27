import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

describe("markPoolEntrySelected conditional claim", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when UPDATE … WHERE selected_at IS NULL claims the row", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "entry-1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const { markPoolEntrySelected } = await import("@/lib/trains/pool");
    await expect(markPoolEntrySelected("entry-1", "2026-07-27")).resolves.toBe(
      true,
    );
    expect(where).toHaveBeenCalled();
  });

  it("returns false when another caller already claimed the row", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update,
    } as unknown as ReturnType<typeof dbModule.getDb>);

    const { markPoolEntrySelected } = await import("@/lib/trains/pool");
    await expect(markPoolEntrySelected("entry-1", "2026-07-28")).resolves.toBe(
      false,
    );
  });
});
