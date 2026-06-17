export type ExtractionConfig = {
  mode: "scene" | "fps";
  sceneThreshold?: number;
  sampleFps?: number;
};

export const DEFAULT_PRIMARY_PASS: ExtractionConfig = {
  mode: "scene",
  sceneThreshold: 0.25,
  sampleFps: 1,
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
