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

export function engineRequiresAshed(engine: VideoOcrEngine): boolean {
  return engine === "ashed";
}

/** Resolve engine for a job from env + score target id. */
export function resolveVideoOcrEngineForJob(scoreTargetId: string, isRoster: boolean): VideoOcrEngine {
  return videoOcrEngineForTarget(resolveVideoOcrProvider(), isRoster);
}
