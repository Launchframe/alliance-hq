import {
  logPipelineStep,
  type PipelineStepMeta,
} from "@/lib/video/pipeline-step-log";

export type PhaseTimings = Record<string, number>;

export class PipelineTimer {
  private readonly startedAt = Date.now();
  private readonly phases = new Map<string, number>();
  private openPhase: { name: string; startedAt: number } | null = null;

  startPhase(name: string) {
    this.endPhase();
    this.openPhase = { name, startedAt: Date.now() };
  }

  endPhase() {
    if (!this.openPhase) {
      return;
    }
    const elapsed = Date.now() - this.openPhase.startedAt;
    const name = this.openPhase.name;
    this.phases.set(name, (this.phases.get(name) ?? 0) + elapsed);
    this.openPhase = null;
  }

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startPhase(name);
    try {
      return await fn();
    } finally {
      this.endPhase();
    }
  }

  addPhase(name: string, ms: number) {
    this.phases.set(name, (this.phases.get(name) ?? 0) + ms);
  }

  /** Log one hop immediately and roll it into phase totals. */
  logStep(step: string, ms: number, extra: PipelineStepMeta = {}) {
    logPipelineStep(step, ms, extra);
    this.addPhase(step, ms);
  }

  async measureStep<T>(
    step: string,
    fn: () => Promise<T>,
    extra?: PipelineStepMeta | ((result: T) => PipelineStepMeta),
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      const meta =
        typeof extra === "function" ? extra(result) : (extra ?? {});
      this.logStep(step, Date.now() - started, meta);
      return result;
    } catch (error) {
      this.logStep(step, Date.now() - started, {
        ...(typeof extra === "object" && extra ? extra : {}),
        error: error instanceof Error ? error.message : "failed",
      });
      throw error;
    }
  }

  getPhases(): PhaseTimings {
    this.endPhase();
    return Object.fromEntries(this.phases.entries());
  }

  getTotalMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Structured log for worker / server stdout */
  log(label: string, extra: Record<string, unknown> = {}) {
    const phases = this.getPhases();
    const totalMs = this.getTotalMs();
    const slowest = Object.entries(phases).sort(([, a], [, b]) => b - a)[0];

    console.log(
      `[video-pipeline] ${label}`,
      JSON.stringify({
        totalMs,
        phases,
        slowestPhase: slowest?.[0] ?? null,
        slowestMs: slowest?.[1] ?? null,
        ...extra,
      }),
    );
  }
}
