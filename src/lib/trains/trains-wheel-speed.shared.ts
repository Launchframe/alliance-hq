/** Wheel animation speed presets (multiplier applied to base reel timing). */
export const TRAINS_WHEEL_SPIN_SPEEDS = ["slow", "regular", "fast"] as const;

export type TrainsWheelSpinSpeed = (typeof TRAINS_WHEEL_SPIN_SPEEDS)[number];

export const DEFAULT_TRAINS_WHEEL_SPIN_SPEED: TrainsWheelSpinSpeed = "slow";

export function normalizeTrainsWheelSpinSpeed(
  value: unknown,
): TrainsWheelSpinSpeed {
  if (
    typeof value === "string" &&
    (TRAINS_WHEEL_SPIN_SPEEDS as readonly string[]).includes(value)
  ) {
    return value as TrainsWheelSpinSpeed;
  }
  return DEFAULT_TRAINS_WHEEL_SPIN_SPEED;
}

/** Maps user pref → animation multiplier (higher = shorter spin). */
export function wheelSpeedMultiplier(speed: TrainsWheelSpinSpeed): number {
  switch (speed) {
    case "slow":
      return 1;
    case "regular":
      return 2;
    case "fast":
      return 3;
  }
}
