import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  SSE_MAX_CONNECTION_MS,
  sseChunk,
} from "@/app/api/events/video-jobs/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), snapshot: vi.fn(), create: vi.fn(), listen: vi.fn(), end: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireApiSession: mocks.session }));
vi.mock("@/lib/events/video-jobs-query", () => ({ getRecentOwnedVideoJobs: mocks.snapshot }));
vi.mock("@/lib/db/postgres-listen", () => ({ startPostgresListen: mocks.listen }));
vi.mock("@/lib/events/video-jobs", () => ({
  createVideoJobListenClient: mocks.create,
  VIDEO_JOB_NOTIFY_CHANNEL: "test_video",
  parseVideoJobStatusEvent: () => null,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "test-session", hqUserId: "test-user", currentAllianceId: "test-alliance" });
  mocks.snapshot.mockResolvedValue([]);
  mocks.end.mockResolvedValue(undefined);
  mocks.create.mockReturnValue({ end: mocks.end });
  mocks.listen.mockResolvedValue(mocks.stop);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("video-jobs SSE helpers", () => {
  it("formats SSE event chunks", () => {
    expect(sseChunk("reconnect", { t: 1 })).toBe(
      'event: reconnect\ndata: {"t":1}\n\n',
    );
  });

  it("closes before Vercel 300s limit", () => {
    expect(SSE_MAX_CONNECTION_MS).toBeLessThan(300_000);
    expect(SSE_MAX_CONNECTION_MS).toBeGreaterThan(60_000);
  });
});

describe("video-jobs early disconnect cleanup", () => {
  it("still requires a session when the request is already aborted", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request("http://localhost/api/events/video-jobs", { signal: controller.signal }));
    expect(response.status).toBe(401);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not allocate resources for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request("http://localhost/api/events/video-jobs", { signal: controller.signal }));
    expect(mocks.session).toHaveBeenCalledOnce();
    await expect(response.body!.getReader().read()).resolves.toMatchObject({ done: true });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not open a listener after disconnect during the snapshot query", async () => {
    const snapshot = deferred<never[]>();
    mocks.snapshot.mockReturnValue(snapshot.promise);
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/events/video-jobs", { signal: controller.signal }));
    expect(mocks.session).toHaveBeenCalledOnce();
    const read = response.body!.getReader().read();
    await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalledOnce());
    controller.abort();
    snapshot.resolve([]);
    await expect(read).resolves.toMatchObject({ done: true });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends a pending listener immediately and stops its late probe", async () => {
    const listening = deferred<() => void>();
    mocks.listen.mockReturnValue(listening.promise);
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/events/video-jobs", { signal: controller.signal }));
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    controller.abort();
    expect(mocks.end).toHaveBeenCalledWith({ timeout: 0 });
    listening.resolve(mocks.stop);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    const reader = response.body!.getReader();
    const snapshot = await reader.read();
    expect(snapshot.done).toBe(false);
    expect(new TextDecoder().decode(snapshot.value)).toBe(sseChunk("snapshot", { jobs: [] }));
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
