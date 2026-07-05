import { describe, expect, it, vi } from "vitest";

import { startPostgresListen } from "./postgres-listen";

describe("startPostgresListen", () => {
  it("invokes onError and closes the client when listen rejects", async () => {
    const listen = vi.fn().mockRejectedValue(new Error("28P01"));
    const end = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    await startPostgresListen(
      { listen, end } as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      () => undefined,
      onError,
    );

    expect(listen).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
  });

  it("does not call onError when listen succeeds", async () => {
    const listen = vi.fn().mockResolvedValue(undefined);
    const end = vi.fn();
    const onError = vi.fn();

    await startPostgresListen(
      { listen, end } as Parameters<typeof startPostgresListen>[0],
      "test_channel",
      () => undefined,
      onError,
    );

    expect(onError).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
});
