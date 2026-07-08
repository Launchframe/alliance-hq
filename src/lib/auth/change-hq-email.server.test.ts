import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  confirmHqEmailChange,
  isHqUserEmailTakenByOther,
  requestHqEmailChange,
} from "./change-hq-email.server";

function hashCode(input: {
  hqUserId: string;
  newEmail: string;
  code: string;
}): string {
  return createHash("sha256")
    .update(`${input.hqUserId}:${input.newEmail}:${input.code.trim()}`)
    .digest("hex");
}

describe("isHqUserEmailTakenByOther", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when another hq user owns the email", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "other-user" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      isHqUserEmailTakenByOther({
        email: "taken@example.com",
        excludeHqUserId: "self-user",
      }),
    ).resolves.toBe(true);
  });
});

describe("requestHqEmailChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E2E_TEST;
  });

  it("rejects when the new email is already the current email", async () => {
    await expect(
      requestHqEmailChange({
        hqUserId: "user-1",
        currentEmail: "same@example.com",
        newEmailRaw: "same@example.com",
      }),
    ).rejects.toMatchObject({ code: "same_email" });
  });

  it("rejects when another account already uses the email", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "other-user" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      requestHqEmailChange({
        hqUserId: "user-1",
        currentEmail: "old@example.com",
        newEmailRaw: "taken@example.com",
      }),
    ).rejects.toMatchObject({ code: "email_in_use" });
  });
});

describe("confirmHqEmailChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates hq_users.email when the verification code matches", async () => {
    const hqUserId = "user-1";
    const newEmail = "new@example.com";
    const code = "424242";
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: "pending-1",
                    hqUserId,
                    newEmail,
                    codeHash: hashCode({ hqUserId, newEmail, code }),
                    failedAttempts: 0,
                    expiresAt: new Date(Date.now() + 60_000),
                  },
                ]),
              }),
            }),
          }),
        }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: updateWhere }),
      }),
    } as never);

    await expect(
      confirmHqEmailChange({
        hqUserId,
        currentEmail: "old@example.com",
        newEmailRaw: newEmail,
        codeRaw: code,
        sessionId: "session-1",
      }),
    ).resolves.toEqual({ email: newEmail });

    expect(updateWhere).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });
});
