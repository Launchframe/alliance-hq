/**
 * Client-safe OCR provider / engine resolution for the video pipeline.
 */

export type VideoOcrProvider = "ashed" | "local" | "mock";

/** Per-job OCR engine used for a single pass. */
export type VideoOcrEngine = "ashed" | "native" | "mock";

const PROVIDERS: ReadonlySet<string> = new Set(["ashed", "local", "mock"]);

export type VideoOcrResolutionContext = {
  /** Alliance queue setting — forces in-house Tesseract instead of Ashed OCR. */
  allianceHqOcrOnly?: boolean;
};

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

/** Env default, optionally overridden by the alliance video-queue setting. */
export function resolveEffectiveVideoOcrProvider(
  context?: VideoOcrResolutionContext,
): VideoOcrProvider {
  if (context?.allianceHqOcrOnly) {
    return "local";
  }
  return resolveVideoOcrProvider();
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

/** Resolve whether the worker should load an Ashed credential for this engine. */
export async function resolveVideoJobAshedConnection(params: {
  engine: VideoOcrEngine;
  loadConnection: () => Promise<unknown | null>;
}): Promise<unknown | null> {
  if (!engineRequiresAshed(params.engine)) return null;
  return params.loadConnection();
}

/** Resolve engine for a job from env/alliance override + score target id. */
export function resolveVideoOcrEngineForJob(
  scoreTargetId: string,
  isRoster: boolean,
  context?: VideoOcrResolutionContext,
): VideoOcrEngine {
  return videoOcrEngineForTarget(
    resolveEffectiveVideoOcrProvider(context),
    isRoster,
  );
}

/**
 * Whether approving/running queued jobs requires a live Ashed connection,
 * given env and optional alliance override. Mirrors the approve-route gate.
 */
export function videoOcrRequiresAshedConnection(
  context?: VideoOcrResolutionContext,
): boolean {
  return engineRequiresAshed(
    videoOcrEngineForTarget(resolveEffectiveVideoOcrProvider(context), true),
  );
}
