import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isVideoDevShadowWithholdUxEnabled,
  isVideoForceExtractionShadowEnabled,
  resolveShadowWithholdEscapeMs,
} from "./early-shadow-dev.shared";
import { VS_SHADOW_WITHHOLD_DEFAULT_MS } from "./early-shadow-eligibility.shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("early-shadow-dev flags", () => {
  it("disables force shadow on Vercel production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VIDEO_FORCE_EXTRACTION_SHADOW", "true");
    expect(isVideoForceExtractionShadowEnabled()).toBe(false);
  });

  it("enables force shadow in local non-prod when set", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VIDEO_FORCE_EXTRACTION_SHADOW", "true");
    expect(isVideoForceExtractionShadowEnabled()).toBe(true);
  });

  it("enables withhold UX only for withhold value", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VIDEO_DEV_SHADOW_UX", "withhold");
    expect(isVideoDevShadowWithholdUxEnabled()).toBe(true);
    vi.stubEnv("VIDEO_DEV_SHADOW_UX", "nope");
    expect(isVideoDevShadowWithholdUxEnabled()).toBe(false);
  });

  it("resolves custom withhold timeout in non-prod", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VIDEO_DEV_SHADOW_WITHHOLD_MS", "15000");
    expect(resolveShadowWithholdEscapeMs()).toBe(15_000);
  });

  it("keeps default timeout on production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VIDEO_DEV_SHADOW_WITHHOLD_MS", "15000");
    expect(resolveShadowWithholdEscapeMs()).toBe(VS_SHADOW_WITHHOLD_DEFAULT_MS);
  });
});
