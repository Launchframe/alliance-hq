import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  AuthEmailCodeError,
  generateAuthEmailCode,
  issueAuthEmailCode,
  verifyAuthEmailCode,
} from "./email-code.server";

describe("generateAuthEmailCode", () => {
  it("returns a 6-digit string", () => {
    const code = generateAuthEmailCode();
    expect(code).toMatch(/^[0-9]{6}$/);
  });
});

describe("verifyAuthEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for invalid code format", async () => {
    await expect(
      verifyAuthEmailCode("user@example.com", "abc"),
    ).resolves.toBeNull();
  });

  it("deletes the code row after successful verification", async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { id: "code-1", email: "user@example.com" },
              ]),
            }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: deleteWhere,
      }),
    } as never);

    await expect(
      verifyAuthEmailCode("user@example.com", "123456"),
    ).resolves.toEqual({ email: "user@example.com" });
    expect(deleteWhere).toHaveBeenCalled();
  });
});

describe("issueAuthEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects invalid email addresses", async () => {
    await expect(issueAuthEmailCode("not-an-email")).rejects.toBeInstanceOf(
      AuthEmailCodeError,
    );
  });

  it("rate limits repeat requests for the same email", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "recent" }]),
            }),
          }),
        }),
      }),
    } as never);

    await expect(issueAuthEmailCode("user@example.com")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});
