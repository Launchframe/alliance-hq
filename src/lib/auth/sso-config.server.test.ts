import { afterEach, describe, expect, it } from "vitest";

import {
  getAuthSsoAvailability,
  isDiscordOAuthConfigured,
  isGoogleOAuthConfigured,
} from "./sso-config.server";

describe("sso-config", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("reports OAuth off when secrets are missing", () => {
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
    delete process.env.AUTH_DISCORD_ID;
    delete process.env.AUTH_DISCORD_SECRET;
    expect(getAuthSsoAvailability()).toEqual({ google: false, discord: false });
  });

  it("reports Google on when id + secret are set", () => {
    process.env.AUTH_GOOGLE_ID = "google-id";
    process.env.AUTH_GOOGLE_SECRET = "google-secret";
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("reports Discord on when id + secret are set", () => {
    process.env.AUTH_DISCORD_ID = "discord-id";
    process.env.AUTH_DISCORD_SECRET = "discord-secret";
    expect(isDiscordOAuthConfigured()).toBe(true);
  });
});
