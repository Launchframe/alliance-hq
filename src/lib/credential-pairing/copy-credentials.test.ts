import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getAshedCredentialRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  }),
  schema: {
    ashedCredentials: {
      id: "ashedCredentials.id",
      sessionId: "ashedCredentials.sessionId",
    },
  },
}));

import { getAshedCredentialRecord } from "@/lib/session";

import { copyEncryptedCredentialsToSession } from "./copy-credentials";

function chainSelectWithLimit<T>(rows: T[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("copyEncryptedCredentialsToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("copies ashedUserId when inserting into a fresh target session", async () => {
    vi.mocked(getAshedCredentialRecord).mockResolvedValue({
      id: "cred-src",
      sessionId: "desktop-sess",
      ashedUserId: "ashed-user-1",
      appId: "app",
      originUrl: "https://ashed.example",
      encryptedToken: "enc",
      tokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
      expiryReminderDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    selectMock.mockReturnValueOnce(chainSelectWithLimit([]));

    await copyEncryptedCredentialsToSession("desktop-sess", "mobile-sess");

    expect(insertMock).toHaveBeenCalled();
    const values = insertMock.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      sessionId: "mobile-sess",
      ashedUserId: "ashed-user-1",
      appId: "app",
      originUrl: "https://ashed.example",
      encryptedToken: "enc",
    });
  });

  it("copies ashedUserId when updating an existing target credential row", async () => {
    vi.mocked(getAshedCredentialRecord).mockResolvedValue({
      id: "cred-src",
      sessionId: "desktop-sess",
      ashedUserId: "ashed-user-1",
      appId: "app",
      originUrl: "https://ashed.example",
      encryptedToken: "enc",
      tokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
      expiryReminderDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    selectMock.mockReturnValueOnce(
      chainSelectWithLimit([{ id: "cred-target", sessionId: "mobile-sess" }]),
    );

    await copyEncryptedCredentialsToSession("desktop-sess", "mobile-sess");

    expect(updateMock).toHaveBeenCalled();
    const setPayload = updateMock.mock.results[0]?.value.set.mock.calls[0]?.[0];
    expect(setPayload).toMatchObject({
      ashedUserId: "ashed-user-1",
      encryptedToken: "enc",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
