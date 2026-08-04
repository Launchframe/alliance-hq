import { describe, expect, it } from "vitest";

import { resolveBankLifecycleStage } from "@/lib/banks/bank-lifecycle.shared";

describe("resolveBankLifecycleStage", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("returns active when no deadlines are set", () => {
    expect(
      resolveBankLifecycleStage({ abandonedAt: null, dropByAt: null }, now),
    ).toBe("active");
  });

  it("returns dropping_soon when dropByAt is in the future", () => {
    expect(
      resolveBankLifecycleStage(
        { dropByAt: "2026-07-28T00:00:00.000Z" },
        now,
      ),
    ).toBe("dropping_soon");
  });

  it("returns abandoned when dropByAt is in the past (legacy soft-archive)", () => {
    expect(
      resolveBankLifecycleStage(
        { dropByAt: "2026-07-20T00:00:00.000Z" },
        now,
      ),
    ).toBe("abandoned");
  });

  it("returns abandoned when dropByAt equals now", () => {
    expect(
      resolveBankLifecycleStage(
        { dropByAt: "2026-07-27T12:00:00.000Z" },
        now,
      ),
    ).toBe("abandoned");
  });

  it("returns abandoned when abandonedAt is set even with a future dropByAt", () => {
    expect(
      resolveBankLifecycleStage(
        {
          abandonedAt: "2026-07-27T10:00:00.000Z",
          dropByAt: "2026-07-30T00:00:00.000Z",
        },
        now,
      ),
    ).toBe("abandoned");
  });

  it("returns abandoned when only abandonedAt is set", () => {
    expect(
      resolveBankLifecycleStage(
        { abandonedAt: "2026-07-27T10:00:00.000Z" },
        now,
      ),
    ).toBe("abandoned");
  });
});
