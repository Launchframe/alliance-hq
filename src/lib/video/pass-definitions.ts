export type ExtractionConfig = {
  mode: "scene" | "fps";
  sceneThreshold?: number;
  sampleFps?: number;
  /**
   * In scene mode, also capture a frame every N source frames so fast scrolls
   * through short rank sections are not missed. Derived from video fps and
   * `sampleFps` when not set explicitly.
   */
  supplementFps?: number;
};

export const DEFAULT_PRIMARY_PASS: ExtractionConfig = {
  mode: "scene",
  sceneThreshold: 0.25,
  sampleFps: 1,
};

/** Denser sampling for roster videos — short rank sections scroll past quickly. */
export const DEFAULT_ROSTER_VIDEO_PASS: ExtractionConfig = {
  mode: "scene",
  sceneThreshold: 0.1,
  sampleFps: 2,
  supplementFps: 2,
};

export const SHADOW_PASS_AB: ExtractionConfig = {
  mode: "scene",
  sceneThreshold: 0.1,
  sampleFps: 2,
};

export const PASS_KEY_FOR_CONFIG = {
  scene_0_25: "scene_0.25",
  scene_0_10: "scene_0.1",
  fps_2: "fps_2",
} as const;
