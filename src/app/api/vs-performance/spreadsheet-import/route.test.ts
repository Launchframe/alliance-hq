import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  requirePermission: vi.fn(),
  importScores: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: mocks.requirePermission,
}));
vi.mock("@/lib/vs-scores/spreadsheet-import.server", () => ({
  importVsSpreadsheetScores: mocks.importScores,
  VsSpreadsheetFileError: class VsSpreadsheetFileError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/vs-scores/spreadsheet-file.server", () => ({
  VS_SPREADSHEET_MAX_BYTES: 1024 * 1024,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { POST } from "./route";

function multipartRequest(fileName = "weekly.csv", body = "Name,Points\nA,1\n") {
  const form = new FormData();
  form.set(
    "file",
    new File([body], fileName, { type: "text/csv" }),
  );
  form.set("period", "weekly");
  form.set("recordedDate", "2026-10-04");
  return new Request("https://example.test/api/vs-performance/spreadsheet-import", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session",
    hqUserId: "user",
    currentAllianceId: "tenant",
  });
  mocks.requirePermission.mockResolvedValue(null);
  mocks.importScores.mockResolvedValue({
    jobId: "job-1",
    groupId: "group-1",
    parseSessionId: "parse-1",
    recordedDate: "2026-10-04",
    period: "weekly",
    rowCount: 1,
    matchedCount: 1,
    warnings: [],
  });
});

describe("POST /api/vs-performance/spreadsheet-import", () => {
  it("returns 401 when there is no API session", async () => {
    mocks.session.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const response = await POST(multipartRequest());
    expect(response.status).toBe(401);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.importScores).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous sessions before import", async () => {
    mocks.session.mockResolvedValue({
      id: "bootstrap",
      hqUserId: null,
      currentAllianceId: "tenant",
    });
    const response = await POST(multipartRequest());
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.importScores).not.toHaveBeenCalled();
  });

  it("returns 403 when scores:write is denied", async () => {
    mocks.requirePermission.mockResolvedValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
    const response = await POST(multipartRequest());
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      "session",
      "tenant",
      "scores:write",
    );
    expect(mocks.importScores).not.toHaveBeenCalled();
  });

  it("imports when the officer has scores:write", async () => {
    const response = await POST(multipartRequest());
    expect(response.status).toBe(200);
    const json = (await response.json()) as { jobId: string; matchedCount: number };
    expect(json.jobId).toBe("job-1");
    expect(json.matchedCount).toBe(1);
    expect(mocks.importScores).toHaveBeenCalledTimes(1);
    const args = mocks.importScores.mock.calls[0]?.[0] as {
      allianceId: string;
      hqUserId: string;
      fileName: string;
      period: string;
      recordedDate: string;
    };
    expect(args.allianceId).toBe("tenant");
    expect(args.hqUserId).toBe("user");
    expect(args.fileName).toBe("weekly.csv");
    expect(args.period).toBe("weekly");
    expect(args.recordedDate).toBe("2026-10-04");
  });
});
