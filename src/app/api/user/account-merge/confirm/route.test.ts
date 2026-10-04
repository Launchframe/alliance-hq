import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveSessionHqUserId: vi.fn(),
  readSessionId: vi.fn(),
  confirmAccountMerge: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => state.auth(...args),
}));

vi.mock("@/lib/auth/resolve-session-hq-user.server", () => ({
  resolveSessionHqUserId: (...args: unknown[]) =>
    state.resolveSessionHqUserId(...args),
}));

vi.mock("@/lib/session", () => ({
  readSessionId: (...args: unknown[]) => state.readSessionId(...args),
}));

vi.mock("@/lib/auth/account-merge-proof.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/account-merge-proof.server")>();
  return {
    ...actual,
    confirmAccountMerge: (...args: unknown[]) =>
      state.confirmAccountMerge(...args),
  };
});

import { AccountMergeProofError } from "@/lib/auth/account-merge-proof.server";

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/user/account-merge/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/user/account-merge/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.mockResolvedValue({ user: { id: "auth-1" } });
    state.resolveSessionHqUserId.mockResolvedValue("canonical");
    state.readSessionId.mockResolvedValue("browser-session-1");
    state.confirmAccountMerge.mockResolvedValue({ merged: true });
  });

  it("returns 401 without touching the proof layer when unauthenticated", async () => {
    state.auth.mockResolvedValue(null);
    const res = await POST(request({ sourceEmail: "a@b.test", code: "424242" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth_required" });
    expect(state.confirmAccountMerge).not.toHaveBeenCalled();
  });

  it("maps an exhausted identity race to a retryable 409 without logging a server error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    state.confirmAccountMerge.mockRejectedValue(
      new AccountMergeProofError(
        "activity_identity_changed",
        "identity_changed",
      ),
    );

    const res = await POST(
      request({ sourceEmail: "a@b.test", code: "424242" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "identity_changed" });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps unrelated failures as generic 500s", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("db blew up");
    state.confirmAccountMerge.mockRejectedValue(failure);

    const res = await POST(
      request({ sourceEmail: "a@b.test", code: "424242" }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
