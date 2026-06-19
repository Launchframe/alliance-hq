export const COVER_FLOW_SNAP_DURATION_MS = 220;
export const COVER_FLOW_MOMENTUM_FRICTION = 0.94;
export const COVER_FLOW_MOMENTUM_MIN_VELOCITY = 0.04;

export type CoverFlowDragSample = { x: number; t: number };

export function estimateCoverFlowReleaseVelocityPxPerMs(
  samples: CoverFlowDragSample[],
): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  const windowMs = 120;
  let start = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const sample = samples[i]!;
    if (last.t - sample.t <= windowMs) {
      start = sample;
    } else {
      break;
    }
  }
  const dt = Math.max(last.t - start.t, 8);
  return (last.x - start.x) / dt;
}

export type CoverFlowItemTransform = {
  translateX: number;
  rotateY: number;
  scale: number;
  opacity: number;
  zIndex: number;
};

export function coverFlowItemTransform(
  offset: number,
  visibleRange = 2,
  translateXPercent = 60,
): CoverFlowItemTransform {
  const translateX = offset * translateXPercent;
  const rotateY = offset === 0 ? 0 : offset * -30;
  const scale = 1 - Math.abs(offset) * 0.15;
  const opacity = 1 - Math.abs(offset) * 0.35;
  const zIndex = visibleRange - Math.abs(offset);
  return { translateX, rotateY, scale, opacity, zIndex };
}

export function coverFlowItemStyle(
  offset: number,
  interacting: boolean,
  visibleRange = 2,
  translateXPercent = 60,
): {
  transform: string;
  opacity: number;
  zIndex: number;
} {
  const { translateX, rotateY, scale, opacity, zIndex } = coverFlowItemTransform(
    offset,
    visibleRange,
    translateXPercent,
  );
  return {
    transform: `translate(-50%, -50%) translateX(${translateX}%) rotateY(${rotateY}deg) scale(${scale})`,
    opacity,
    zIndex,
  };
}
