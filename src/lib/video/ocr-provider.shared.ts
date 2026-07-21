/**
 * Client-safe OCR provider / engine resolution for the video pipeline.
 */

export type VideoOcrProvider = "ashed" | "local" | "mock";

/** Per-job OCR engine used for a single pass. */
export type VideoOcrEngine = "ashed" | "native" | "mock";

/**
 * Fired as each frame's OCR settles during a job's OCR pass, for the
 * waiting-page progress bar. May return a promise — callers that need to
 * order a DB write relative to frame completion (see process-job.ts) should
 * await it before moving on to the next frame.
 */
export type VideoOcrProgressCallback = (
  completedFrames: number,
  totalFrames: number,
) => void | Promise<void>;

const PROVIDERS: ReadonlySet<string> = new Set(["ashed", "local", "mock"]);

export type VideoOcrResolutionContext = {
  /** Alliance queue setting — forces in-house Tesseract instead of Ashed OCR. */
  allianceHqOcrOnly?: boolean;
};

export type VideoOcrEngineTargetOptions = {
  /** Roster (and similar): when provider is `local`, use Tesseract. */
  useNativeWhenLocal: boolean;
  /**
   * Deposit slip history (and similar): Ashed has no schema.
   * Always native unless the deploy is in mock mode.
   */
  forceNative?: boolean;
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

/** True when this deploy can run Ashed OCR (default production path). */
export function isAshedOcrAvailableOnDeploy(): boolean {
  return resolveVideoOcrProvider() === "ashed";
}

/** Alliance toggle with deploy override — non-Ashed deploys always use in-house OCR. */
export function effectiveAllianceHqOcrOnly(storedHqOcrOnly: boolean): boolean {
  if (!isAshedOcrAvailableOnDeploy()) {
    return true;
  }
  return storedHqOcrOnly;
}

/** Env default, optionally overridden by the alliance video-queue setting. */
export function resolveEffectiveVideoOcrProvider(
  context?: VideoOcrResolutionContext,
): VideoOcrProvider {
  const deployProvider = resolveVideoOcrProvider();
  if (deployProvider !== "ashed") {
    return deployProvider;
  }
  if (context?.allianceHqOcrOnly) {
    return "local";
  }
  return "ashed";
}

export function videoOcrEngineForTarget(
  provider: VideoOcrProvider,
  options: VideoOcrEngineTargetOptions | boolean,
): VideoOcrEngine {
  const opts: VideoOcrEngineTargetOptions =
    typeof options === "boolean"
      ? { useNativeWhenLocal: options }
      : options;

  if (opts.forceNative) {
    return provider === "mock" ? "mock" : "native";
  }
  if (provider === "ashed") return "ashed";
  if (provider === "mock") return "mock";
  return opts.useNativeWhenLocal ? "native" : "mock";
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

/** Resolve engine for a job from env/alliance override + score target flags. */
export function resolveVideoOcrEngineForJob(
  scoreTargetId: string,
  isRoster: boolean,
  context?: VideoOcrResolutionContext,
  options?: { forceNative?: boolean },
): VideoOcrEngine {
  void scoreTargetId;
  return videoOcrEngineForTarget(resolveEffectiveVideoOcrProvider(context), {
    useNativeWhenLocal: isRoster || Boolean(options?.forceNative),
    forceNative: options?.forceNative,
  });
}

/**
 * Whether approving/running queued jobs requires a live Ashed connection,
 * given env and optional alliance override. Mirrors the approve-route gate.
 */
export function videoOcrRequiresAshedConnection(
  context?: VideoOcrResolutionContext,
): boolean {
  if (!isAshedOcrAvailableOnDeploy()) {
    return false;
  }
  return engineRequiresAshed(
    videoOcrEngineForTarget(resolveEffectiveVideoOcrProvider(context), {
      useNativeWhenLocal: true,
    }),
  );
}
