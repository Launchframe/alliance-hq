import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AshedConnectAuthMismatchError,
  AshedConnectEmailStubCollisionError,
  assertAuthMayMergeIntoCanonicalHqUser,
  hqUsersShareEmail,
  sessionMergedAuthStubHqUserId,
  signingInUserMatchesConnectedSessionOwner,
} from "@/lib/auth/session-connect-identity";
import * as ashedMembershipModule from "@/lib/rbac/ashed-session-membership";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    hqUsers: { id: "id", email: "email", ashedUserId: "ashedUserId" },
    hqAuthAccounts: { provider: "provider", hqUserId: "hqUserId" },
    auditLog: {
      metadata: "metadata",
      sessionId: "sessionId",
      action: "action",
      createdAt: "createdAt",
    },
  },
}));

describe("signingInUserMatchesConnectedSessionOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true for the same hq user id", async () => {
    await expect(
      signingInUserMatchesConnectedSessionOwner({
        sessionId: "sess-1",
        signingInHqUserId: "user-a",
        sessionOwnerHqUserId: "user-a",
      }),
    ).resolves.toBe(true);
  });

  it("returns true when the signing-in user holds the session Ashed credential", async () => {
    vi.spyOn(
      ashedMembershipModule,
      "sessionHoldsAshedIdentityForHqUser",
    ).mockResolvedValue(true);

    await expect(
      signingInUserMatchesConnectedSessionOwner({
        sessionId: "sess-1",
        signingInHqUserId: "magic-stub",
        sessionOwnerHqUserId: "canonical-user",
      }),
    ).resolves.toBe(true);
  });
});

describe("sessionMergedAuthStubHqUserId", () => {
  it("returns mergedFromHqUserId from the latest ashed.rebind audit row", async () => {
    const limit = vi.fn().mockResolvedValue([
      { metadata: { mergedFromHqUserId: "magic-stub" } },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(sessionMergedAuthStubHqUserId("sess-1")).resolves.toBe(
      "magic-stub",
    );
  });
});

describe("assertAuthMayMergeIntoCanonicalHqUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows magic-link stub email to merge into canonical Ashed row", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "player@example.com" }])
      .mockResolvedValueOnce([{ email: "player@example.com" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      assertAuthMayMergeIntoCanonicalHqUser({
        authHqUserId: "magic-stub",
        canonicalHqUserId: "canonical-user",
        ashedEmail: "player@example.com",
        ashedUserId: "ashed-abc",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a Google SSO session binding another user's Ashed seat", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "other@gmail.com" }])
      .mockResolvedValueOnce([{ email: "maintainer@e2e.test" }])
      .mockResolvedValueOnce([{ email: "other@gmail.com" }])
      .mockResolvedValueOnce([{ email: "maintainer@e2e.test" }])
      .mockResolvedValueOnce([
        {
          email: "maintainer@e2e.test",
          ashedUserId: "ashed-maintainer",
        },
      ])
      .mockResolvedValueOnce([
        { email: "other@gmail.com", ashedUserId: null },
      ]);
    const where = vi
      .fn()
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([{ provider: "google" }])
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([{ provider: "google" }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      assertAuthMayMergeIntoCanonicalHqUser({
        authHqUserId: "google-user-b",
        canonicalHqUserId: "canonical-maintainer",
        ashedEmail: "maintainer@e2e.test",
        ashedUserId: "ashed-maintainer",
      }),
    ).rejects.toBeInstanceOf(AshedConnectAuthMismatchError);
  });

  it("allows a second invite stub with a different email to merge the same Ashed seat", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "magic-b@e2e.test" }])
      .mockResolvedValueOnce([{ email: "magic-a@e2e.test" }])
      .mockResolvedValueOnce([{ email: "magic-b@e2e.test" }])
      .mockResolvedValueOnce([{ email: "magic-a@e2e.test" }])
      .mockResolvedValueOnce([
        { email: "magic-b@e2e.test", ashedUserId: null },
      ])
      .mockResolvedValueOnce([
        { email: "magic-a@e2e.test", ashedUserId: "ashed-abc" },
      ]);
    const where = vi
      .fn()
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([])
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([])
      .mockReturnValueOnce({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      assertAuthMayMergeIntoCanonicalHqUser({
        authHqUserId: "magic-stub-b",
        canonicalHqUserId: "canonical-user",
        ashedEmail: "player@e2e.test",
        ashedUserId: "ashed-abc",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects hijack when canonical HQ row owns the Ashed email", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "intruder@e2e.test" }])
      .mockResolvedValueOnce([{ email: "maintainer@e2e.test" }])
      .mockResolvedValueOnce([{ email: "intruder@e2e.test" }])
      .mockResolvedValueOnce([{ email: "maintainer@e2e.test" }])
      .mockResolvedValueOnce([
        { email: "intruder@e2e.test", ashedUserId: null },
      ])
      .mockResolvedValueOnce([
        { email: "maintainer@e2e.test", ashedUserId: "ashed-maintainer" },
      ]);
    const where = vi
      .fn()
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([])
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([])
      .mockReturnValueOnce({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      assertAuthMayMergeIntoCanonicalHqUser({
        authHqUserId: "intruder",
        canonicalHqUserId: "canonical-maintainer",
        ashedEmail: "maintainer@e2e.test",
        ashedUserId: "ashed-maintainer",
      }),
    ).rejects.toBeInstanceOf(AshedConnectAuthMismatchError);
  });

  it("rejects Google SSO when an email-only HQ stub owns the Ashed email", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "officer@gmail.com" }])
      .mockResolvedValueOnce([{ email: "officer@ashed.example.com" }])
      .mockResolvedValueOnce([{ email: "officer@gmail.com" }])
      .mockResolvedValueOnce([{ email: "officer@ashed.example.com" }])
      .mockResolvedValueOnce([
        { email: "officer@ashed.example.com", ashedUserId: null },
      ]);
    const where = vi
      .fn()
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockReturnValueOnce({ limit })
      .mockResolvedValueOnce([{ provider: "google" }])
      .mockReturnValueOnce({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(
      assertAuthMayMergeIntoCanonicalHqUser({
        authHqUserId: "google-officer",
        canonicalHqUserId: "email-stub",
        ashedEmail: "officer@ashed.example.com",
        ashedUserId: "ashed-officer",
      }),
    ).rejects.toBeInstanceOf(AshedConnectEmailStubCollisionError);
  });
});

describe("hqUsersShareEmail", () => {
  it("returns true when both users share a normalized email", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ email: "Player@Example.com" }])
      .mockResolvedValueOnce([{ email: "player@example.com" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockReturnValue({ select } as never);

    await expect(hqUsersShareEmail("user-a", "user-b")).resolves.toBe(true);
  });
});
