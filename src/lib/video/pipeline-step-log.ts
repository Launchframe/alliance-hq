export type PipelineStepMeta = Record<string, unknown>;

/** Immediate stdout log for a single pipeline hop (network call, ffmpeg, etc.). */
export function logPipelineStep(
  step: string,
  ms: number,
  extra: PipelineStepMeta = {},
) {
  console.log(
    "[video-pipeline] step",
    JSON.stringify({
      step,
      ms,
      ...extra,
    }),
  );
}
