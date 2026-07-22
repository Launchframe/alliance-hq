const DEFAULT_HOLD_MS = 500;
const DEFAULT_MOVE_TOLERANCE_PX = 10;

export type LongPressPointerPoint = {
  clientX: number;
  clientY: number;
  button?: number;
};

export type LongPressControllerOptions = {
  onLongPress: (point: LongPressPointerPoint) => void;
  holdMs?: number;
  moveTolerancePx?: number;
  disabled?: boolean;
  /** Dynamic option readers — prefer these when the host may re-render mid-hold. */
  getHoldMs?: () => number | undefined;
  getMoveTolerancePx?: () => number | undefined;
  isDisabled?: () => boolean;
  /** Injected for tests; defaults to window timers. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

/**
 * Pointer long-press with move-cancel (safe for carousels / swipe).
 * Framework-agnostic so it can be unit-tested without React Testing Library.
 */
export function createLongPressController({
  onLongPress,
  holdMs = DEFAULT_HOLD_MS,
  moveTolerancePx = DEFAULT_MOVE_TOLERANCE_PX,
  disabled = false,
  getHoldMs,
  getMoveTolerancePx,
  isDisabled,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: LongPressControllerOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;

  function resolveHoldMs() {
    return getHoldMs?.() ?? holdMs;
  }

  function resolveMoveTolerancePx() {
    return getMoveTolerancePx?.() ?? moveTolerancePx;
  }

  function resolveDisabled() {
    return isDisabled?.() ?? disabled;
  }

  function clearTimer() {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    start = null;
  }

  return {
    onPointerDown(point: LongPressPointerPoint) {
      if (resolveDisabled() || (point.button ?? 0) !== 0) return;
      fired = false;
      clearTimer();
      start = { x: point.clientX, y: point.clientY };
      timer = setTimeoutFn(() => {
        timer = null;
        fired = true;
        onLongPress(point);
      }, resolveHoldMs());
    },
    onPointerMove(point: LongPressPointerPoint) {
      if (!start || timer == null) return;
      const dx = point.clientX - start.x;
      const dy = point.clientY - start.y;
      const tolerance = resolveMoveTolerancePx();
      if (dx * dx + dy * dy > tolerance * tolerance) {
        clearTimer();
      }
    },
    onPointerUp() {
      clearTimer();
    },
    onPointerCancel() {
      clearTimer();
    },
    didFireLongPress() {
      return fired;
    },
    clearLongPressFlag() {
      fired = false;
    },
  };
}

export type LongPressController = ReturnType<typeof createLongPressController>;
