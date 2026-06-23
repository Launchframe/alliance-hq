import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";
import * as passphraseModule from "@/lib/auth/passphrase";

import { verifyPasswordLogin, registerPasswordAccount, PasswordAuthError } from "./password.server";

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

  it("rejects registration when email already has a password", async () => {
    vi.spyOn(passphraseModule, "hashPassphrase").mockResolvedValue("hashed");
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: "user-1",
                email: "taken@example.com",
                displayName: null,
                passwordHash: "existing-hash",
              },
            ]),
          }),
        }),
      }),
    } as never);

    await expect(
      registerPasswordAccount({
        email: "taken@example.com",
        password: "valid-password",
        confirmPassword: "valid-password",
      }),
    ).rejects.toBeInstanceOf(PasswordAuthError);
  });
});
