import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/auth/resolve-hq-user", () => ({
  ensureHqUserForAuthEmail: vi.fn().mockResolvedValue("from-email"),
}));

import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";
import { resolveSessionHqUserId } from "./resolve-session-hq-user.server";

describe("resolveSessionHqUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers JWT sub when the hq_users row exists", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "canonical-user" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      resolveSessionHqUserId({
        user: {
          id: "canonical-user",
          email: "stale@example.com",
        },
        expires: "",
      }),
    ).resolves.toBe("canonical-user");

    expect(ensureHqUserForAuthEmail).not.toHaveBeenCalled();
  });

  it("falls back to ensureHqUserForAuthEmail when sub is missing", async () => {
    await expect(
      resolveSessionHqUserId({
        user: { id: "", email: "user@example.com" },
        expires: "",
      }),
    ).resolves.toBe("from-email");

    expect(ensureHqUserForAuthEmail).toHaveBeenCalledWith(
      "user@example.com",
      undefined,
    );
  });
});
