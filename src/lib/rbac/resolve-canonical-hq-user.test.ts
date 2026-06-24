import { beforeEach, describe, expect, it, vi } from "vitest";

import { AshedConnectAuthMismatchError } from "@/lib/auth/session-connect-identity";
import { resolveCanonicalHqUserForAshedConnect } from "@/lib/rbac/resolve-canonical-hq-user";

const selectMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();

vi.mock("nanoid", () => ({
  nanoid: () => "new-hq-user-id",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    update: updateMock,
    insert: insertMock,
  }),
  schema: {
    hqUsers: {
      id: "hqUsers.id",
      ashedUserId: "hqUsers.ashedUserId",
      email: "hqUsers.email",
      displayName: "hqUsers.displayName",
    },
  },
}));

function chainSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function chainUpdate() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe("resolveCanonicalHqUserForAshedConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue(chainUpdate());
    insertMock.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("returns existing canonical row by ashedUserId and records magic-link merge", async () => {
    selectMock
      .mockReturnValueOnce(
        chainSelect([
          {
            id: "canonical-1",
            email: "player@example.com",
            displayName: "Canonical",
            ashedUserId: "ashed-abc",
          },
        ]),
      )
      .mockReturnValueOnce(chainSelect([{ email: "player@example.com" }]))
      .mockReturnValueOnce(chainSelect([{ email: "player@example.com" }]));

    const result = await resolveCanonicalHqUserForAshedConnect({
      ashedUserId: "ashed-abc",
      ashedEmail: "player@example.com",
      displayName: "Updated Name",
      authHqUserId: "magic-stub-a",
    });

    expect(result).toEqual({
      hqUserId: "canonical-1",
      mergedFromHqUserId: "magic-stub-a",
    });
    expect(updateMock).toHaveBeenCalled();
  });

  it("adopts magic-link stub when no canonical row exists yet", async () => {
    selectMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(
        chainSelect([
          {
            id: "magic-stub-a",
            email: "player@example.com",
            displayName: null,
            ashedUserId: null,
          },
        ]),
      );

    const result = await resolveCanonicalHqUserForAshedConnect({
      ashedUserId: "ashed-abc",
      ashedEmail: "player@example.com",
      displayName: "Player One",
      authHqUserId: "magic-stub-a",
    });

    expect(result).toEqual({ hqUserId: "magic-stub-a" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws when email row is bound to a different Ashed identity", async () => {
    selectMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(
        chainSelect([
          {
            id: "email-row",
            email: "player@example.com",
            displayName: "Player",
            ashedUserId: "other-ashed-id",
          },
        ]),
      );

    await expect(
      resolveCanonicalHqUserForAshedConnect({
        ashedUserId: "ashed-abc",
        ashedEmail: "player@example.com",
        authHqUserId: "magic-stub-b",
      }),
    ).rejects.toThrow(/already linked to a different HQ user/i);
  });

  it("creates a new HQ user when no row matches", async () => {
    selectMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([]));

    const result = await resolveCanonicalHqUserForAshedConnect({
      ashedUserId: "ashed-new",
      ashedEmail: "new@example.com",
      displayName: "New Player",
      authHqUserId: "magic-stub-c",
    });

    expect(result).toEqual({
      hqUserId: "new-hq-user-id",
      mergedFromHqUserId: "magic-stub-c",
    });
    expect(insertMock).toHaveBeenCalled();
  });

  it("requires a normalized Ashed email", async () => {
    await expect(
      resolveCanonicalHqUserForAshedConnect({
        ashedEmail: "   ",
      }),
    ).rejects.toThrow(/Ashed email is required/i);
  });

  it("rejects hijacking a canonical Ashed user from a different signed-in HQ account", async () => {
    selectMock
      .mockReturnValueOnce(
        chainSelect([
          {
            id: "canonical-maintainer",
            email: "maintainer@e2e.test",
            displayName: "Maintainer",
            ashedUserId: "ashed-maintainer",
          },
        ]),
      )
      .mockReturnValueOnce(chainSelect([{ email: "other@gmail.com" }]))
      .mockReturnValueOnce(chainSelect([{ email: "maintainer@e2e.test" }]))
      .mockReturnValueOnce(
        chainSelect([{ email: "other@gmail.com", ashedUserId: null }]),
      );

    await expect(
      resolveCanonicalHqUserForAshedConnect({
        ashedUserId: "ashed-maintainer",
        ashedEmail: "maintainer@e2e.test",
        authHqUserId: "google-sso-user-b",
      }),
    ).rejects.toBeInstanceOf(AshedConnectAuthMismatchError);
  });
});
