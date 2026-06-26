import { afterEach, describe, expect, it, vi } from "vitest";

import {
  engineRequiresAshed,
  resolveVideoOcrProvider,
  videoOcrEngineForTarget,
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
