import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";
import * as passphraseModule from "@/lib/auth/passphrase";

import {
  verifyPasswordLogin,
  setPasswordForHqUser,
  PasswordAuthError,
} from "./password.server";

describe("verifyPasswordLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs bcrypt compare even when the user row is missing", async () => {
    const verifySpy = vi
      .spyOn(passphraseModule, "verifyPassphrase")
      .mockResolvedValue(false);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never);

    await expect(
      verifyPasswordLogin("missing@example.com", "wrong-password"),
    ).resolves.toBeNull();
    expect(verifySpy).toHaveBeenCalledWith(
      "wrong-password",
      passphraseModule.TIMING_SAFE_DUMMY_HASH,
    );
  });

  it("runs bcrypt compare when the user has no password hash yet", async () => {
    const verifySpy = vi
      .spyOn(passphraseModule, "verifyPassphrase")
      .mockResolvedValue(false);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: "user-1",
                email: "magic@example.com",
                displayName: null,
                passwordHash: null,
              },
            ]),
          }),
        }),
      }),
    } as never);

    await expect(
      verifyPasswordLogin("magic@example.com", "wrong-password"),
    ).resolves.toBeNull();
    expect(verifySpy).toHaveBeenCalledWith(
      "wrong-password",
      passphraseModule.TIMING_SAFE_DUMMY_HASH,
    );
  });
});

describe("setPasswordForHqUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the HQ user row is missing", async () => {
    vi.spyOn(passphraseModule, "hashPassphrase").mockResolvedValue("hashed");
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never);

    await expect(
      setPasswordForHqUser({
        hqUserId: "missing-user",
        password: "valid-password",
        confirmPassword: "valid-password",
      }),
    ).rejects.toBeInstanceOf(PasswordAuthError);
  });
});
