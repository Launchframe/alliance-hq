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
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
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
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("allows first-time set without a current password", async () => {
    vi.spyOn(passphraseModule, "hashPassphrase").mockResolvedValue("hashed");
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "user-1", passwordHash: null },
            ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "user-1" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      setPasswordForHqUser({
        hqUserId: "user-1",
        password: "valid-password",
        confirmPassword: "valid-password",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects overwrite when current password is missing", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "user-1", passwordHash: "existing-hash" },
            ]),
          }),
        }),
      }),
    } as never);

    await expect(
      setPasswordForHqUser({
        hqUserId: "user-1",
        password: "valid-password",
        confirmPassword: "valid-password",
      }),
    ).rejects.toMatchObject({ code: "current_password_required" });
  });

  it("rejects overwrite when current password is wrong", async () => {
    vi.spyOn(passphraseModule, "verifyPassphrase").mockResolvedValue(false);
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "user-1", passwordHash: "existing-hash" },
            ]),
          }),
        }),
      }),
    } as never);

    await expect(
      setPasswordForHqUser({
        hqUserId: "user-1",
        password: "valid-password",
        confirmPassword: "valid-password",
        currentPassword: "wrong-password",
      }),
    ).rejects.toMatchObject({ code: "current_password_incorrect" });
  });

  it("updates when current password verifies", async () => {
    const verifySpy = vi
      .spyOn(passphraseModule, "verifyPassphrase")
      .mockResolvedValue(true);
    vi.spyOn(passphraseModule, "hashPassphrase").mockResolvedValue("new-hash");
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "user-1", passwordHash: "existing-hash" },
            ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "user-1" }]),
          }),
        }),
      }),
    } as never);

    await expect(
      setPasswordForHqUser({
        hqUserId: "user-1",
        password: "valid-password",
        confirmPassword: "valid-password",
        currentPassword: "correct-password",
      }),
    ).resolves.toBeUndefined();
    expect(verifySpy).toHaveBeenCalledWith(
      "correct-password",
      "existing-hash",
    );
  });
});
