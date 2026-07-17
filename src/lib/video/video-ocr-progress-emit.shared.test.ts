import { describe, expect, it, vi } from "vitest";

import { createThrottledOcrProgressEmitter } from "@/lib/video/video-ocr-progress-emit.shared";

describe("createThrottledOcrProgressEmitter", () => {
  it("emits the first progress update immediately", async () => {
    const emit = vi.fn(async () => undefined);
    const onProgress = createThrottledOcrProgressEmitter({
      minIntervalMs: 1_200,
      emit,
      now: () => 1_000,
    });

    await onProgress(1, 10);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(1, 10);
  });

  it("throttles non-final updates within the interval", async () => {
    let now = 1_000;
    const emit = vi.fn(async () => undefined);
    const onProgress = createThrottledOcrProgressEmitter({
      minIntervalMs: 1_200,
      emit,
      now: () => now,
    });

    await onProgress(1, 10);
    now = 1_500;
    await onProgress(2, 10);
    expect(emit).toHaveBeenCalledTimes(1);

    now = 2_300;
    await onProgress(3, 10);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(3, 10);
  });

  it("always emits the final frame even inside the throttle window", async () => {
    let now = 1_000;
    const emit = vi.fn(async () => undefined);
    const onProgress = createThrottledOcrProgressEmitter({
      minIntervalMs: 1_200,
      emit,
      now: () => now,
    });

    await onProgress(1, 10);
    now = 1_100;
    await onProgress(10, 10);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(10, 10);
  });

  it("serializes overlapping calls and drops stale completed counts", async () => {
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const emit = vi.fn(async (completed: number) => {
      if (completed === 1) {
        await firstGate;
      }
      order.push(completed);
    });

    const onProgress = createThrottledOcrProgressEmitter({
      minIntervalMs: 0,
      emit,
      now: () => Date.now(),
    });

    const p1 = onProgress(1, 10);
    const p2 = onProgress(2, 10);
    // Stale count scheduled after a newer one — must be ignored once chain runs.
    const pStale = onProgress(1, 10);

    releaseFirst();
    await Promise.all([p1, p2, pStale]);

    expect(order).toEqual([1, 2]);
  });

  it("swallows emit errors so OCR is not failed by progress", async () => {
    const emit = vi.fn(async () => {
      throw new Error("notify failed");
    });
    const onProgress = createThrottledOcrProgressEmitter({
      minIntervalMs: 0,
      emit,
    });

    await expect(onProgress(1, 5)).resolves.toBeUndefined();
  });
});
