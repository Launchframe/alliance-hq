/**
 * Client-safe OCR provider / engine resolution for the video pipeline.
 */

export type VideoOcrProvider = "ashed" | "local" | "mock";

/** Per-job OCR engine used for a single pass. */
export type VideoOcrEngine = "ashed" | "native" | "mock";

const PROVIDERS: ReadonlySet<string> = new Set(["ashed", "local", "mock"]);

export function resolveVideoOcrProvider(): VideoOcrProvider {
  const raw = process.env.VIDEO_OCR_PROVIDER?.trim().toLowerCase();
  if (!raw || !PROVIDERS.has(raw) || raw === "ashed") {
    return "ashed";
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.VIDEO_OCR_ALLOW_NONPROD !== "true"
  ) {
    return "ashed";
  }

  return raw as VideoOcrProvider;
}

export function videoOcrEngineForTarget(
  provider: VideoOcrProvider,
  isRosterTarget: boolean,
): VideoOcrEngine {
  if (provider === "ashed") return "ashed";
  if (provider === "mock") return "mock";
  return isRosterTarget ? "native" : "mock";
}

export function shouldEnqueueAshedOcrShadowPasses(engine: VideoOcrEngine): boolean {
  return engine === "ashed";
}

/** Returns true when the pipeline requires a live Ashed connection for this engine. */
export function engineRequiresAshed(engine: VideoOcrEngine): boolean {
  return engine === "ashed";
}

/**
 * Whether approving/running any queued job requires a live Ashed connection,
 * given the configured provider. Native/mock OCR (used by native alliances and
 * dev/e2e) never needs Ashed; the default `ashed` provider always does. The
 * roster vs non-roster distinction does not change this — only the `ashed`
 * provider yields an Ashed-bound engine. Mirrors the approve route gate.
 */
export function videoOcrRequiresAshedConnection(): boolean {
  return engineRequiresAshed(videoOcrEngineForTarget(resolveVideoOcrProvider(), true));
}

/** Resolve whether the worker should load an Ashed credential for this engine. */
export async function resolveVideoJobAshedConnection(params: {
  engine: VideoOcrEngine;
  loadConnection: () => Promise<unknown | null>;
}): Promise<unknown | null> {
  if (!engineRequiresAshed(params.engine)) return null;
  return params.loadConnection();
}

/** Resolve engine for a job from env + score target id. */
export function resolveVideoOcrEngineForJob(scoreTargetId: string, isRoster: boolean): VideoOcrEngine {
  return videoOcrEngineForTarget(resolveVideoOcrProvider(), isRoster);
}
