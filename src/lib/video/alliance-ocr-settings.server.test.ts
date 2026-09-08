import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: mocks.getDb,
}));
import { loadAllianceVideoOcrContext } from "./alliance-ocr-settings.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.getDb.mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) });
});
afterEach(() => vi.unstubAllEnvs());

describe("loadAllianceVideoOcrContext", () => {
  it("loads native operating mode and the unchanged OCR preference in one read", async () => {
    mocks.limit.mockResolvedValue([{ operatingMode: "native", videoHqOcrOnly: 0 }]);
    expect(await loadAllianceVideoOcrContext("native-alliance")).toEqual({ allianceOperatingMode: "native", allianceHqOcrOnly: false });
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.limit).toHaveBeenCalledOnce();
  });

  it("does not infer native mode from missing alliance rows", async () => {
    mocks.limit.mockResolvedValue([]);
    expect(await loadAllianceVideoOcrContext("missing")).toEqual({ allianceOperatingMode: "ashed", allianceHqOcrOnly: false });
  });

  it("does not access the DB without an alliance", async () => {
    expect(await loadAllianceVideoOcrContext(null)).toEqual({});
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
