import { describe, expect, it, vi } from "vitest";

import { startPostgresListen } from "./postgres-listen";

describe("startPostgresListen", () => {
  it("invokes onError and closes the client when listen rejects", async () => {
    const authError = new Error("28P01");
    const listen = vi.fn().mockRejectedValue(authError);
    const end = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await startPostgresListen(
      { listen, end } as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      () => undefined,
      onError,
    );

    expect(listen).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(authError);
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
    expect(consoleError).toHaveBeenCalledWith(
      "[postgres-listen] LISTEN failed:",
      authError,
    );

    consoleError.mockRestore();
  });

  it("does not call onError when listen succeeds", async () => {
    const onPayload = vi.fn();
    const listen = vi.fn().mockImplementation(async (_channel, callback) => {
      callback("payload");
    });
    const end = vi.fn();
    const onError = vi.fn();

    await startPostgresListen(
      { listen, end } as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      onPayload,
      onError,
    );

    expect(listen).toHaveBeenCalledWith("test_channel", onPayload);
    expect(onPayload).toHaveBeenCalledWith("payload");
    expect(onError).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("still closes the client when onError throws", async () => {
    const listen = vi.fn().mockRejectedValue(new Error("28P01"));
    const end = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn().mockImplementation(() => {
      throw new Error("closeStream failed");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await startPostgresListen(
      { listen, end } as Parameters<typeof startPostgresListen>[0],
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
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      startPostgresListen(
        { listen, end } as Parameters<typeof startPostgresListen>[0],
        "test_channel",
        () => undefined,
        onError,
      ),
    ).resolves.toBeUndefined();
  });
});
