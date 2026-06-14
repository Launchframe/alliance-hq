import { describe, expect, it, vi } from "vitest";

import { PipelineTimer } from "@/lib/video/pipeline-timer";

describe("PipelineTimer", () => {
  it("tracks phase timings and totals", async () => {
    vi.useFakeTimers();
    const timer = new PipelineTimer();

    const result = await timer.measure("phase_a", async () => {
      vi.advanceTimersByTime(10);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(timer.getPhases()).toEqual({ phase_a: 10 });
    vi.advanceTimersByTime(5);
    expect(timer.getTotalMs()).toBeGreaterThanOrEqual(15);

    timer.addPhase("manual", 3);
    timer.addPhase("manual", 2);
    expect(timer.getPhases().manual).toBe(5);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    new PipelineTimer().log("empty");
    expect(logSpy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
