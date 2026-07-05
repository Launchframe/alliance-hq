import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  attachPostgresListenProbe,
  startPostgresListen,
} from "./postgres-listen";

describe("startPostgresListen", () => {
  it("invokes onError and closes the client when listen rejects", async () => {
    const authError = new Error("28P01");
    const listen = vi.fn().mockRejectedValue(authError);
    const end = vi.fn().mockResolvedValue(undefined);
    const unsafe = vi.fn();
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const mockClient = { listen, end, unsafe };
    const stopProbe = await startPostgresListen(
      mockClient as unknown as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      () => undefined,
      onError,
      {
        isIntentionalClose: () => false,
        onDisconnect: vi.fn(),
        probeIntervalMs: 60_000,
      },
    );

    expect(listen).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(authError);
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
    expect(consoleError).toHaveBeenCalledWith(
      "[postgres-listen] LISTEN failed:",
      authError,
    );
    stopProbe();

    consoleError.mockRestore();
  });

  it("does not call onError when listen succeeds", async () => {
    const onPayload = vi.fn();
    const listen = vi.fn().mockImplementation(async (_channel, callback) => {
      callback("payload");
    });
    const end = vi.fn();
    const unsafe = vi.fn().mockResolvedValue([]);
    const onError = vi.fn();

    const mockClient = { listen, end, unsafe };
    const stopProbe = await startPostgresListen(
      mockClient as unknown as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      onPayload,
      onError,
    );

    expect(listen).toHaveBeenCalledWith("test_channel", onPayload);
    expect(onPayload).toHaveBeenCalledWith("payload");
    expect(onError).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    stopProbe();
  });

  it("still closes the client when onError throws", async () => {
    const listen = vi.fn().mockRejectedValue(new Error("28P01"));
    const end = vi.fn().mockResolvedValue(undefined);
    const unsafe = vi.fn();
    const onError = vi.fn().mockImplementation(() => {
      throw new Error("closeStream failed");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const mockClient = { listen, end, unsafe };
    await startPostgresListen(
      mockClient as unknown as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      () => undefined,
      onError,
    );

    expect(end).toHaveBeenCalledWith({ timeout: 0 });
    expect(consoleError).toHaveBeenCalledWith(
      "[postgres-listen] onError handler failed:",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });

  it("swallows end rejections after listen fails", async () => {
    const listen = vi.fn().mockRejectedValue(new Error("28P01"));
    const end = vi.fn().mockRejectedValue(new Error("already closed"));
    const unsafe = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const mockClient = { listen, end, unsafe };
    await expect(
      startPostgresListen(
        mockClient as unknown as Parameters<typeof startPostgresListen>[0],
        "test_channel",
        () => undefined,
        onError,
      ),
    ).resolves.toBeInstanceOf(Function);
  });
});

describe("attachPostgresListenProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onDisconnect when probe query fails", async () => {
    const probeError = new Error("CONNECTION_CLOSED");
    const unsafe = vi.fn().mockRejectedValue(probeError);
    const onDisconnect = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const stop = attachPostgresListenProbe(
      { unsafe },
      {
        isIntentionalClose: () => false,
        onDisconnect,
        probeIntervalMs: 1_000,
      },
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(unsafe).toHaveBeenCalledWith("select 1");
    expect(onDisconnect).toHaveBeenCalledOnce();

    stop();
  });

  it("does not call onDisconnect after intentional close", async () => {
    let intentional = false;
    const unsafe = vi.fn().mockRejectedValue(new Error("CONNECTION_CLOSED"));
    const onDisconnect = vi.fn();

    const stop = attachPostgresListenProbe(
      { unsafe },
      {
        isIntentionalClose: () => intentional,
        onDisconnect,
        probeIntervalMs: 1_000,
      },
    );

    intentional = true;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onDisconnect).not.toHaveBeenCalled();
    stop();
  });
});
