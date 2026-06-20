import { afterEach, describe, expect, it, vi } from "vitest";

describe("isNativeInviteRequired", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is always on", async () => {
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "false");
    const { isNativeInviteRequired } = await import("./invite-gate");
    expect(isNativeInviteRequired()).toBe(true);
  });
});

describe("isAshedInviteRequired", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is off in local dev by default", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "");
    vi.stubEnv("HQ_INVITE_REQUIRED", "");
    const { isAshedInviteRequired } = await import("./invite-gate");
    expect(isAshedInviteRequired()).toBe(false);
  });

  it("is on when VERCEL_ENV is production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "");
    const { isAshedInviteRequired } = await import("./invite-gate");
    expect(isAshedInviteRequired()).toBe(true);
  });

  it("prefers HQ_ASHED_INVITE_REQUIRED over legacy HQ_INVITE_REQUIRED", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "false");
    vi.stubEnv("HQ_INVITE_REQUIRED", "true");
    const { isAshedInviteRequired } = await import("./invite-gate");
    expect(isAshedInviteRequired()).toBe(false);
  });

  it("falls back to legacy HQ_INVITE_REQUIRED", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "");
    vi.stubEnv("HQ_INVITE_REQUIRED", "true");
    const { isAshedInviteRequired } = await import("./invite-gate");
    expect(isAshedInviteRequired()).toBe(true);
  });
});

describe("emailHasAshedConnectAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows all emails when ashed gate is disabled", async () => {
    vi.stubEnv("HQ_ASHED_INVITE_REQUIRED", "false");
    const { emailHasAshedConnectAccess } = await import("./invite-gate");
    expect(await emailHasAshedConnectAccess("any@example.com")).toBe(true);
  });
});

describe("emailHasAshedConnectPermission", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns false for empty email (normalization short-circuits)", async () => {
    const { emailHasAshedConnectPermission } = await import("./invite-gate");
    expect(await emailHasAshedConnectPermission("")).toBe(false);
  });

  it("returns false for whitespace-only email", async () => {
    const { emailHasAshedConnectPermission } = await import("./invite-gate");
    expect(await emailHasAshedConnectPermission("   ")).toBe(false);
  });
});
