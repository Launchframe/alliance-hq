"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  createLongPressController,
  type LongPressController,
  type LongPressPointerPoint,
} from "@/lib/client/long-press.shared";

export type UseLongPressOptions = {
  onLongPress: (event: ReactPointerEvent<HTMLElement>) => void;
  holdMs?: number;
  moveTolerancePx?: number;
  disabled?: boolean;
};

export type UseLongPressResult = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  didFireLongPress: () => boolean;
  clearLongPressFlag: () => void;
};

function toPoint(event: ReactPointerEvent<HTMLElement>): LongPressPointerPoint {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
  };
}

/**
 * Pointer long-press with move-cancel (safe for carousels / swipe).
 * Callers should skip the following click when `didFireLongPress()` is true.
 */
export function useLongPress({
  onLongPress,
  holdMs,
  moveTolerancePx,
  disabled = false,
}: UseLongPressOptions): UseLongPressResult {
  const controllerRef = useRef<LongPressController | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const controller = createLongPressController({
      onLongPress: (point) => {
        firedRef.current = true;
        onLongPress({
          clientX: point.clientX,
          clientY: point.clientY,
          button: point.button ?? 0,
        } as ReactPointerEvent<HTMLElement>);
      },
      holdMs,
      moveTolerancePx,
      disabled,
    });
    controllerRef.current = controller;
    return () => {
      controller.onPointerCancel();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [disabled, holdMs, moveTolerancePx, onLongPress]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    firedRef.current = false;
    controllerRef.current?.onPointerDown(toPoint(event));
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    controllerRef.current?.onPointerMove(toPoint(event));
  }, []);
  const onPointerUp = useCallback(() => {
    controllerRef.current?.onPointerUp();
  }, []);
  const onPointerCancel = useCallback(() => {
    controllerRef.current?.onPointerCancel();
  }, []);

  const didFireLongPress = useCallback(() => firedRef.current, []);
  const clearLongPressFlag = useCallback(() => {
    firedRef.current = false;
    controllerRef.current?.clearLongPressFlag();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    didFireLongPress,
    clearLongPressFlag,
  };
}
