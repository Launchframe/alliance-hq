import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isMagicLinkLogOnly,
  logMagicLinkToStdout,
  shouldLogMagicLinkToStdout,
} from "./magic-link-email.server";

describe("magic-link-email dev helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldLogMagicLinkToStdout()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldLogMagicLinkToStdout()).toBe(false);
  });

  it("parses AUTH_MAGIC_LINK_LOG_ONLY", () => {
    vi.stubEnv("AUTH_MAGIC_LINK_LOG_ONLY", "true");
    expect(isMagicLinkLogOnly()).toBe(true);
    vi.stubEnv("AUTH_MAGIC_LINK_LOG_ONLY", "0");
    expect(isMagicLinkLogOnly()).toBe(false);
  });

  it("prints magic link URL to stdout", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logMagicLinkToStdout("test@e2e.test", "http://localhost:5175/api/auth/callback/resend?token=abc");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("test@e2e.test"),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("token=abc"),
    );
  });
});
