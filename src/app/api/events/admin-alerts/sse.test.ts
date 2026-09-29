import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_MAX_CONNECTION_MS,
  sseChunk,
} from "@/app/api/events/admin-alerts/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), create: vi.fn(), listen: vi.fn(), end: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ readSessionId: mocks.session }));
vi.mock("@/lib/rbac/require-permission", () => ({ requirePlatformMaintainer: mocks.permission }));
vi.mock("@/lib/db/postgres-listen", () => ({ startPostgresListen: mocks.listen }));
vi.mock("@/lib/events/admin-alerts", () => ({
  createAdminAlertListenClient: mocks.create,
  ADMIN_ALERT_NOTIFY_CHANNEL: "test_alerts",
  parseAdminAlertEvent: () => null,
  adminAlertSseEventName: () => "alert",
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.session.mockResolvedValue("test-session");
  mocks.permission.mockResolvedValue(null);
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

describe("admin-alerts SSE helpers", () => {
  it("formats SSE event chunks", () => {
    expect(sseChunk("reconnect", { t: 1 })).toBe(
      'event: reconnect\ndata: {"t":1}\n\n',
    );
  });

  it("closes before Vercel 300s limit", () => {
    expect(SSE_MAX_CONNECTION_MS).toBeLessThan(300_000);
    expect(SSE_MAX_CONNECTION_MS).toBeGreaterThan(60_000);
  });

  it("uses the same heartbeat interval as video-jobs SSE", () => {
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBe(25_000);
  });
});

describe("admin-alerts early disconnect cleanup", () => {
  it("does not allocate resources for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request("http://localhost/api/events/admin-alerts", { signal: controller.signal }));
    await expect(response.body!.getReader().read()).resolves.toMatchObject({ done: true });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends a pending listener immediately and stops its late probe", async () => {
    const listening = deferred<() => void>();
    mocks.listen.mockReturnValue(listening.promise);
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/events/admin-alerts", { signal: controller.signal }));
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    controller.abort();
    expect(mocks.end).toHaveBeenCalledWith({ timeout: 0 });
    listening.resolve(mocks.stop);
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
    await expect(response.body!.getReader().read()).resolves.toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
