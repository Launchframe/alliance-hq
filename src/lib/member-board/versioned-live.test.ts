import { describe, expect, it, vi } from "vitest";
import { createVersionedLive, SnapshotAccessRevoked, type SnapshotObserver, type SnapshotTransport } from "./versioned-live";

type Snapshot = { version: number; members: string[] };
function fixture() {
  let observer!: SnapshotObserver;
  const requests: { signal: AbortSignal; resolve: (value: Snapshot) => void; reject: (error: unknown) => void }[] = [];
  const unsubscribe = vi.fn();
  const dispose = vi.fn();
  const transport: SnapshotTransport<Snapshot> = {
    load: (signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    subscribe: (next) => { observer = next; return unsubscribe; },
    dispose,
  };
  const controller = createVersionedLive({ version: 2, members: ["Ada"] }, transport);
  return { controller, requests, unsubscribe, dispose, observer: () => observer };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("transport-injected versioned collaboration", () => {
  it("loads an alternate organizer and enforces invalidation floors and monotonic versions", async () => {
    const f = fixture();
    f.controller.start();
    f.requests[0].resolve({ version: 3, members: ["Bea"] });
    await flush();
    expect(f.controller.getState().snapshot?.members).toEqual(["Bea"]);
    f.observer().invalidate(8);
    f.requests[1].resolve({ version: 7, members: ["stale"] });
    await flush();
    expect(f.controller.getState().snapshot?.version).toBe(3);
    const refresh = f.controller.refresh();
    f.requests[2].resolve({ version: 8, members: ["Cy"] });
    await refresh;
    expect(f.controller.getState().snapshot).toEqual({ version: 8, members: ["Cy"] });
    f.controller.stop();
  });

  it("holds a confirmed mutation version even before its stream invalidation arrives", async () => {
    const f = fixture();
    f.controller.start();
    f.requests[0].resolve({ version: 2, members: ["Ada"] });
    await flush();
    const confirmed = f.controller.refresh(9);
    f.requests[1].resolve({ version: 8, members: ["stale replica"] });
    await confirmed;
    expect(f.controller.getState().snapshot).toEqual({ version: 2, members: ["Ada"] });
    const retry = f.controller.refresh();
    f.requests[2].resolve({ version: 9, members: ["confirmed"] });
    await retry;
    expect(f.controller.getState().snapshot?.members).toEqual(["confirmed"]);
    f.controller.stop();
  });

  it("ignores out-of-order success and revocation from aborted generations", async () => {
    const f = fixture();
    f.controller.start();
    const second = f.controller.refresh();
    expect(f.requests[0].signal.aborted).toBe(true);
    f.requests[1].resolve({ version: 4, members: ["current"] });
    await second;
    f.requests[0].reject(new SnapshotAccessRevoked());
    await flush();
    expect(f.controller.getState().snapshot?.version).toBe(4);
    expect(f.controller.getState().revoked).toBe(false);
    const third = f.controller.refresh();
    const fourth = f.controller.refresh();
    f.requests[3].resolve({ version: 5, members: ["latest"] });
    await fourth;
    f.requests[2].resolve({ version: 99, members: ["out of order"] });
    await third;
    expect(f.controller.getState().snapshot?.version).toBe(5);
    f.controller.stop();
  });

  it("clears revoked data and disposes subscription, pending loads and lifecycle listeners", async () => {
    const f = fixture();
    const cleanup = vi.fn();
    f.controller.start(() => cleanup);
    f.requests[0].reject(new SnapshotAccessRevoked());
    await flush();
    expect(f.controller.getState()).toMatchObject({ snapshot: null, revoked: true, connected: false });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    f.observer().invalidate(10);
    await f.controller.refresh();
    expect(f.requests).toHaveLength(1);
    f.controller.stop();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it("handles disconnect, reconnect, focus and polling without losing the last authorized snapshot", async () => {
    const f = fixture();
    let check!: () => void;
    f.controller.start((refresh) => { check = refresh; return vi.fn(); });
    f.requests[0].resolve({ version: 2, members: ["Ada"] });
    await flush();
    f.observer().ready(2);
    expect(f.controller.getState().connected).toBe(true);
    f.requests[1].resolve({ version: 2, members: ["Ada"] });
    await flush();
    f.observer().disconnect();
    expect(f.controller.getState().connected).toBe(false);
    f.requests[2].reject(new Error("offline"));
    await flush();
    expect(f.controller.getState().snapshot?.members).toEqual(["Ada"]);
    check();
    f.requests[3].resolve({ version: 3, members: ["Ada", "Bea"] });
    await flush();
    f.observer().ready(3);
    expect(f.controller.getState().connected).toBe(true);
    f.controller.stop();
    expect(f.requests[4].signal.aborted).toBe(true);
  });

  it("falls back to loading and lifecycle checks when a transport cannot subscribe", async () => {
    let check!: () => void;
    const dispose = vi.fn();
    const load = vi.fn().mockResolvedValue({ version: 4, members: ["polling"] });
    const controller = createVersionedLive({ version: 2, members: [] as string[] }, {
      load, subscribe: () => { throw new Error("offline"); }, dispose,
    });
    controller.start((refresh) => { check = refresh; return vi.fn(); });
    await flush();
    expect(controller.getState().snapshot?.version).toBe(4);
    check();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    controller.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("isolates replacement scope/identity controllers and clears stopped pending work", async () => {
    const old = fixture();
    old.controller.start();
    old.requests[0].resolve({ version: 100, members: ["private old scope"] });
    await flush();
    void old.controller.refresh();
    old.controller.stop();
    const next = fixture();
    next.controller.start();
    old.requests[1].resolve({ version: 101, members: ["private old scope"] });
    next.requests[0].resolve({ version: 3, members: ["new scope"] });
    await flush();
    expect(next.controller.getState().snapshot?.members).toEqual(["new scope"]);
    expect(old.requests[1].signal.aborted).toBe(true);
    expect(old.controller.getState().snapshot?.version).toBe(100);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    next.controller.stop();
  });
});
