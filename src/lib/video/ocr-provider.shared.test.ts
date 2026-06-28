import { afterEach, describe, expect, it, vi } from "vitest";

import {
  engineRequiresAshed,
  resolveEffectiveVideoOcrProvider,
  resolveVideoJobAshedConnection,
  resolveVideoOcrProvider,
  shouldEnqueueAshedOcrShadowPasses,
  videoOcrEngineForTarget,
  videoOcrRequiresAshedConnection,
} from "@/lib/video/ocr-provider.shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveVideoOcrProvider", () => {
  it("defaults to ashed", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "");
    expect(resolveVideoOcrProvider()).toBe("ashed");
  });

  it("allows local in non-production", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "local");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveVideoOcrProvider()).toBe("local");
  });

  it("forces ashed in production without VIDEO_OCR_ALLOW_NONPROD", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "mock");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIDEO_OCR_ALLOW_NONPROD", "");
    expect(resolveVideoOcrProvider()).toBe("ashed");
  });

  it("allows mock in production when VIDEO_OCR_ALLOW_NONPROD=true", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "mock");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIDEO_OCR_ALLOW_NONPROD", "true");
    expect(resolveVideoOcrProvider()).toBe("mock");
  });
});

describe("videoOcrEngineForTarget", () => {
  it("maps local provider to native for roster and mock for score targets", () => {
    expect(videoOcrEngineForTarget("local", true)).toBe("native");
    expect(videoOcrEngineForTarget("local", false)).toBe("mock");
  });

  it("maps mock provider to mock for all targets", () => {
    expect(videoOcrEngineForTarget("mock", true)).toBe("mock");
    expect(videoOcrEngineForTarget("mock", false)).toBe("mock");
  });
});

describe("engineRequiresAshed", () => {
  it("is true only for ashed engine", () => {
    expect(engineRequiresAshed("ashed")).toBe(true);
    expect(engineRequiresAshed("native")).toBe(false);
    expect(engineRequiresAshed("mock")).toBe(false);
  });
});

describe("resolveVideoJobAshedConnection", () => {
  it("skips Ashed lookup for native and mock engines", async () => {
    const loadConnection = vi.fn(async () => ({ token: "secret" }));

    await expect(
      resolveVideoJobAshedConnection({ engine: "native", loadConnection }),
    ).resolves.toBeNull();
    await expect(
      resolveVideoJobAshedConnection({ engine: "mock", loadConnection }),
    ).resolves.toBeNull();
    expect(loadConnection).not.toHaveBeenCalled();
  });

  it("loads Ashed connection only for ashed engine", async () => {
    const connection = { token: "secret" };
    const loadConnection = vi.fn(async () => connection);

    await expect(
      resolveVideoJobAshedConnection({ engine: "ashed", loadConnection }),
    ).resolves.toBe(connection);
    expect(loadConnection).toHaveBeenCalledOnce();
  });
});

describe("resolveEffectiveVideoOcrProvider", () => {
  it("forces local when alliance HQ OCR only is enabled", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "");
    expect(
      resolveEffectiveVideoOcrProvider({ allianceHqOcrOnly: true }),
    ).toBe("local");
  });

  it("uses env default when alliance override is off", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "");
    expect(resolveEffectiveVideoOcrProvider({ allianceHqOcrOnly: false })).toBe(
      "ashed",
    );
  });
});

describe("videoOcrRequiresAshedConnection", () => {
  it("does not require Ashed when alliance HQ OCR only is enabled", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "");
    expect(
      videoOcrRequiresAshedConnection({ allianceHqOcrOnly: true }),
    ).toBe(false);
  });

  it("requires Ashed for the default (ashed) provider", () => {
    vi.stubEnv("VIDEO_OCR_PROVIDER", "");
    expect(videoOcrRequiresAshedConnection()).toBe(true);
  });

  it("does not require Ashed for native/local OCR in non-production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VIDEO_OCR_PROVIDER", "local");
    expect(videoOcrRequiresAshedConnection()).toBe(false);
    vi.stubEnv("VIDEO_OCR_PROVIDER", "mock");
    expect(videoOcrRequiresAshedConnection()).toBe(false);
  });

  it("falls back to requiring Ashed when nonprod OCR is not allowed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIDEO_OCR_PROVIDER", "local");
    vi.stubEnv("VIDEO_OCR_ALLOW_NONPROD", "");
    expect(videoOcrRequiresAshedConnection()).toBe(true);
  });
});

describe("shouldEnqueueAshedOcrShadowPasses", () => {
  it("is true only for ashed primary engine", () => {
    expect(shouldEnqueueAshedOcrShadowPasses("ashed")).toBe(true);
    expect(shouldEnqueueAshedOcrShadowPasses("native")).toBe(false);
    expect(shouldEnqueueAshedOcrShadowPasses("mock")).toBe(false);
  });
});
