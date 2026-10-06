import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    id: "sess-1",
    hqUserId: "u1",
    currentAllianceId: "a1",
  },
  requireApiSession: vi.fn(),
  requireSessionPermission: vi.fn(),
  finalizeVideoUploadEnqueue: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: mocks.requireSessionPermission,
}));
vi.mock("@/lib/rbac/constants", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/rbac/constants")>();
  return { ...mod, VIDEO_ENQUEUE_PERMISSION: "hq:video:enqueue" };
});
vi.mock("@/lib/storage", () => ({
  putObject: vi.fn(async () => {}),
  videoStorageKey: vi.fn(() => "videos/k"),
  r2Configured: vi.fn(() => false),
}));
vi.mock("@/lib/video/score-targets", () => ({
  getScoreTarget: vi.fn((id: string) => ({ id, enabled: true })),
  ENABLED_SCORE_TARGETS: [],
}));
vi.mock("@/lib/video/upload-limit", () => ({
  getMaxVideoUploadBytes: () => 1024 * 1024 * 1024,
  getMaxVideoUploadMb: () => 1024,
  isLegacyDirectPostOverLimit: () => false,
  LEGACY_DIRECT_POST_MAX_BYTES: 1024,
  MULTIPART_PART_BYTES: 1024,
  MULTIPART_UPLOAD_THRESHOLD_BYTES: 1024,
}));
vi.mock("@/lib/video/finalize-video-upload", () => ({
  finalizeVideoUploadEnqueue: mocks.finalizeVideoUploadEnqueue,
}));
vi.mock("@/lib/banks/resolve-deposit-slip-upload-bank-id.server", () => ({
  resolveDepositSlipUploadBankId: vi.fn(async () => null),
}));
vi.mock("@/lib/video/video-job-ownership.server", () => ({
  videoJobsOwnedByViewerInAllianceWhere: vi.fn(),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>();
  return { ...mod, getDb: vi.fn() };
});

import { POST } from "./route";

function req(fields: Record<string, string>) {
  const form = new FormData();
  form.set("video", new File([Buffer.alloc(4)], "v.mp4", { type: "video/mp4" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/tools/video-upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue(mocks.session);
  mocks.requireSessionPermission.mockResolvedValue(null);
});

describe("direct upload vsContext validation", () => {
  it("returns a coded 400 for malformed vsContext JSON", async () => {
    const res = await POST(
      req({ scoreTarget: "vs-performance", vsContext: "{not json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", code: "invalid" });
  });

  it("returns a coded 400 for vsContext on a non-vs target", async () => {
    const res = await POST(
      req({
        scoreTarget: "kills",
        vsContext: JSON.stringify({
          recordedDate: "2026-09-28",
          period: "daily",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", code: "invalid" });
  });

  it("returns a coded 400 for schema-invalid vsContext", async () => {
    const res = await POST(
      req({
        scoreTarget: "vs-performance",
        vsContext: JSON.stringify({
          recordedDate: "not-a-date",
          period: "daily",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", code: "invalid" });
  });
});
