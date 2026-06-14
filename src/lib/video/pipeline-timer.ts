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
