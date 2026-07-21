/**
 * Serializes + throttles per-frame OCR progress emits for the waiting-page bar.
 *
 * Callers (process-job) pass an `emit` that writes status/SSE. Concurrent OCR
 * workers may invoke the returned callback overlapping; a promise chain keeps
 * writes ordered, and a monotonic `completed` guard drops stale counts.
 */

export type ThrottledOcrProgressEmitterOptions = {
  minIntervalMs: number;
  emit: (completed: number, total: number) => Promise<void>;
  /** Injectable clock for tests. */
  now?: () => number;
};

/**
 * Returns an async progress callback. Always return/await this from OCR
 * pipelines so in-flight emits drain before the caller moves to
 * `finalizing_rows`.
 */
export function createThrottledOcrProgressEmitter(
  options: ThrottledOcrProgressEmitterOptions,
): (completed: number, total: number) => Promise<void> {
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let lastCompleted = -1;
  let chain: Promise<void> = Promise.resolve();

  return (completed: number, total: number): Promise<void> => {
    chain = chain.then(async () => {
      if (completed < lastCompleted) {
        return;
      }
      const now = (options.now ?? Date.now)();
      const isFinalFrame = total > 0 && completed >= total;
      if (!isFinalFrame && now - lastEmitAt < options.minIntervalMs) {
        return;
      }
      lastEmitAt = now;
      lastCompleted = completed;
      try {
        await options.emit(completed, total);
      } catch {
        // A progress-emit hiccup must not fail the OCR pass.
      }
    });
    return chain;
  };
}
