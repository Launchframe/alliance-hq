import { describe, expect, it, vi } from "vitest";

import { runIsolatedE2eServer } from "./e2e-server-isolated.mjs";

const E2E_URL = "postgresql://e2e:e2e@127.0.0.1:5432/alliance_hq_e2e";

function sourceEnv(overrides = {}) {
  return {
    PATH: "/usr/bin",
    HOME: "/tmp/e2e-home",
    E2E_DATABASE_URL: E2E_URL,
    ...overrides,
  };
}

class FakeChild {
  static nextPid = 4000;

  constructor() {
    this.pid = FakeChild.nextPid++;
    this.exitCode = null;
    this.killed = false;
    this.handlers = new Map();
    this.kill = vi.fn((signal) => {
      this.killed = true;
      this.lastKillSignal = signal;
      return true;
    });
  }

  once(event, listener) {
    this.handlers.set(event, listener);
    return this;
  }

  emitError(error) {
    this.handlers.get("error")?.(error);
  }

  emitExit(code, signal = null) {
    this.exitCode = code ?? (signal ? 1 : 0);
    this.handlers.get("exit")?.(code, signal);
  }
}

function harness(overrides = {}) {
  const children = [];
  const spawnCalls = [];
  const timers = new Map();
  let timerId = 0;
  const registered = new Map();

  const h = {
    spawnImpl: vi.fn((command, args, options) => {
      const child = new FakeChild();
      children.push(child);
      spawnCalls.push({ command, args, options });
      return child;
    }),
    killImpl: vi.fn(),
    setTimeoutImpl: vi.fn((callback, ms) => {
      const id = ++timerId;
      timers.set(id, { callback, ms });
      return id;
    }),
    clearTimeoutImpl: vi.fn((id) => {
      timers.delete(id);
    }),
    registerSignal: vi.fn((signal, handler) => {
      registered.set(signal, handler);
    }),
    unregisterSignal: vi.fn(),
    sourceEnv: sourceEnv(),
    children,
    spawnCalls,
    timers,
    registered,
    ...overrides,
  };
  return h;
}

describe("runIsolatedE2eServer", () => {
  it("builds then starts the server with the same curated env", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);

    expect(h.spawnCalls).toHaveLength(1);
    expect(h.spawnCalls[0].args).toEqual(["run", "build"]);
    expect(h.spawnCalls[0].options.shell).toBe(false);
    expect(h.spawnCalls[0].options.detached).toBe(false);

    h.children[0].emitExit(0);
    await vi.waitFor(() => {
      expect(h.spawnCalls).toHaveLength(2);
    });

    expect(h.spawnCalls[1].command).toBe(process.execPath);
    expect(h.spawnCalls[1].args).toEqual([
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "5176",
    ]);
    expect(h.spawnCalls[1].options.env).toBe(h.spawnCalls[0].options.env);
    expect(h.spawnCalls[1].options.env.DATABASE_URL).toBe(E2E_URL);
    expect(h.spawnCalls[1].options.env.__NEXT_PROCESSED_ENV).toBe("true");

    h.children[1].emitExit(0);
    await expect(run).resolves.toBe(0);
    expect(h.unregisterSignal).toHaveBeenCalled();
  });

  it("does not start the server when the build fails", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    h.children[0].emitExit(2);
    await expect(run).resolves.toBe(2);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it("exits 1 when the build spawn errors", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    h.children[0].emitError(new Error("ENOENT"));
    await expect(run).resolves.toBe(1);
    expect(h.spawnCalls).toHaveLength(1);
  });

  it("relays SIGTERM to the child and never starts the server", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    const build = h.children[0];

    h.registered.get("SIGTERM")();

    expect(h.killImpl).toHaveBeenCalledWith(build.pid, "SIGTERM");
    expect(h.timers.size).toBe(1);

    build.emitExit(0, "SIGTERM");
    await expect(run).resolves.toBe(1);
    expect(h.spawnCalls).toHaveLength(1);
    expect(h.clearTimeoutImpl).toHaveBeenCalled();
    expect(h.killImpl).not.toHaveBeenCalledWith(build.pid, "SIGKILL");
  });

  it("sends SIGKILL to the child when the fallback timer fires", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    const build = h.children[0];

    h.registered.get("SIGINT")();
    const [timer] = [...h.timers.values()];
    expect(timer.ms).toBe(5_000);
    timer.callback();

    expect(h.killImpl).toHaveBeenCalledWith(build.pid, "SIGKILL");

    build.emitExit(null, "SIGKILL");
    await expect(run).resolves.toBe(1);
  });

  it("clears the fallback timer so no stale SIGKILL fires after exit", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    const build = h.children[0];

    h.registered.get("SIGHUP")();
    expect(h.timers.size).toBe(1);
    build.emitExit(null, "SIGHUP");

    expect(h.timers.size).toBe(0);
    await expect(run).resolves.toBe(1);
    expect(h.killImpl).toHaveBeenCalledTimes(1);
    expect(h.killImpl).toHaveBeenCalledWith(build.pid, "SIGHUP");
  });

  it("cleans up signal handlers when the run finishes", async () => {
    const h = harness();
    const run = runIsolatedE2eServer(h);
    h.children[0].emitExit(1);
    await expect(run).resolves.toBe(1);
    expect(h.unregisterSignal).toHaveBeenCalledTimes(3);
  });
});
