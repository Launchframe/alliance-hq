import { beforeEach, describe, expect, it, vi } from "vitest";

const linkAccountMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/auth/adapter", () => ({
  createHqAuthAdapter: () => ({
    linkAccount: linkAccountMock,
  }),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    update: updateMock,
  }),
  schema: {
    hqAuthAccounts: {
      hqUserId: "hqAuthAccounts.hqUserId",
      provider: "hqAuthAccounts.provider",
      providerAccountId: "hqAuthAccounts.providerAccountId",
      providerEmail: "hqAuthAccounts.providerEmail",
      id: "hqAuthAccounts.id",
    },
  },
}));

import { linkOAuthAccountForSignedInUser } from "./account-linking.server";

function chainLimit(rows: unknown[]) {
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

describe("linkOAuthAccountForSignedInUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkAccountMock.mockResolvedValue(undefined);
    updateMock.mockReturnValue(chainUpdate());
  });

  it("links a new Discord account for the signed-in user", async () => {
    selectMock
      .mockReturnValueOnce(chainLimit([]))
      .mockReturnValueOnce(chainLimit([]));

    const result = await linkOAuthAccountForSignedInUser({
      hqUserId: "user-a",
      account: {
        type: "oauth",
        provider: "discord",
        providerAccountId: "discord-1",
      },
      providerEmail: "other@discord.test",
    });

    expect(result).toEqual({ ok: true, action: "linked" });
    expect(linkAccountMock).toHaveBeenCalledOnce();
  });

  it("maps provider-account unique races to provider_account_on_other_user", async () => {
    selectMock
      .mockReturnValueOnce(chainLimit([]))
      .mockReturnValueOnce(chainLimit([]));
    linkAccountMock.mockRejectedValueOnce({
      code: "23505",
      constraint: "hq_auth_accounts_provider_account_unique",
    });
    selectMock.mockReturnValueOnce(
      chainLimit([{ hqUserId: "user-b" }]),
    );

    const result = await linkOAuthAccountForSignedInUser({
      hqUserId: "user-a",
      account: {
        type: "oauth",
        provider: "discord",
        providerAccountId: "discord-1",
      },
      providerEmail: "other@discord.test",
    });

    expect(result).toEqual({
      ok: false,
      code: "provider_account_on_other_user",
    });
  });

  it("maps hq-user-provider unique races to provider_type_already_linked", async () => {
    selectMock
      .mockReturnValueOnce(chainLimit([]))
      .mockReturnValueOnce(chainLimit([]));
    linkAccountMock.mockRejectedValueOnce({
      code: "23505",
      constraint: "hq_auth_accounts_hq_user_provider_unique",
    });

    const result = await linkOAuthAccountForSignedInUser({
      hqUserId: "user-a",
      account: {
        type: "oauth",
        provider: "discord",
        providerAccountId: "discord-2",
      },
      providerEmail: "other@discord.test",
    });

    expect(result).toEqual({
      ok: false,
      code: "provider_type_already_linked",
    });
  });

  it("refreshes provider email when the same user wins a provider-account race", async () => {
    selectMock
      .mockReturnValueOnce(chainLimit([]))
      .mockReturnValueOnce(chainLimit([]));
    linkAccountMock.mockRejectedValueOnce({
      code: "23505",
      constraint: "hq_auth_accounts_provider_account_unique",
    });
    selectMock.mockReturnValueOnce(chainLimit([{ hqUserId: "user-a" }]));

    const result = await linkOAuthAccountForSignedInUser({
      hqUserId: "user-a",
      account: {
        type: "oauth",
        provider: "discord",
        providerAccountId: "discord-1",
      },
      providerEmail: "fresh@discord.test",
    });

    expect(result).toEqual({ ok: true, action: "refreshed" });
    expect(updateMock).toHaveBeenCalledOnce();
  });
});
