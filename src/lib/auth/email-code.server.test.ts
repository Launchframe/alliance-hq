import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

import {
  AuthEmailCodeError,
  AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS,
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
                {
                  id: "code-1",
                  email: "user@example.com",
                  code: "123456",
                  failedAttempts: 0,
                },
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

  it("increments failed attempts on wrong code", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: "code-1",
                  email: "user@example.com",
                  code: "123456",
                  failedAttempts: 1,
                },
              ]),
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: updateWhere,
        }),
      }),
    } as never);

    await expect(
      verifyAuthEmailCode("user@example.com", "000000"),
    ).resolves.toBeNull();
    expect(updateWhere).toHaveBeenCalled();
  });

  it("invalidates the code after max failed attempts", async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: "code-1",
                  email: "user@example.com",
                  code: "123456",
                  failedAttempts: AUTH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS - 1,
                },
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
      verifyAuthEmailCode("user@example.com", "000000"),
    ).resolves.toBeNull();
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
