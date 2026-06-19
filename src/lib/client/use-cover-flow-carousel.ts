"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

import {
  COVER_FLOW_MOMENTUM_FRICTION,
  COVER_FLOW_MOMENTUM_MIN_VELOCITY,
  COVER_FLOW_SNAP_DURATION_MS,
  estimateCoverFlowReleaseVelocityPxPerMs,
} from "@/lib/client/cover-flow-carousel.shared";

type Options = {
  itemCount: number;
  selectedIndex: number;
  pixelsPerItem?: number;
  onSelectedIndexChange?: (index: number) => void;
};

export function useCoverFlowCarousel({
  itemCount,
  selectedIndex,
  pixelsPerItem = 120,
  onSelectedIndexChange,
}: Options) {
  const [position, setPosition] = useState(selectedIndex);
  const [interacting, setInteracting] = useState(false);

  const positionRef = useRef(selectedIndex);
  const dragAnchorXRef = useRef<number | null>(null);
  const dragAnchorPositionRef = useRef(0);
  const dragSamplesRef = useRef<Array<{ x: number; t: number }>>([]);
  const momentumAnimRef = useRef<number | null>(null);
  const snapAnimRef = useRef<number | null>(null);
  const velocityRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const suppressSelectionRef = useRef(false);

  const maxIndex = Math.max(0, itemCount - 1);

  const stopSnap = useCallback(() => {
    if (snapAnimRef.current != null) {
      cancelAnimationFrame(snapAnimRef.current);
      snapAnimRef.current = null;
    }
  }, []);

  const stopMomentum = useCallback(() => {
    if (momentumAnimRef.current != null) {
      cancelAnimationFrame(momentumAnimRef.current);
      momentumAnimRef.current = null;
    }
    lastTickRef.current = null;
    velocityRef.current = 0;
  }, []);

  const setPositionClamped = useCallback(
    (nextPosition: number) => {
      const clamped = Math.max(0, Math.min(maxIndex, nextPosition));
      positionRef.current = clamped;
      setPosition(clamped);
    },
    [maxIndex],
  );

  const emitSelection = useCallback(
    (index: number) => {
      if (suppressSelectionRef.current) return;
      onSelectedIndexChange?.(index);
    },
    [onSelectedIndexChange],
  );

  const snapToNearest = useCallback(() => {
    if (itemCount <= 1) {
      setInteracting(false);
      return;
    }
    stopMomentum();
    stopSnap();

    const target = Math.round(positionRef.current);
    const start = positionRef.current;
    if (Math.abs(target - start) < 0.001) {
      setPositionClamped(target);
      setInteracting(false);
      emitSelection(target);
      return;
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / COVER_FLOW_SNAP_DURATION_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = start + (target - start) * eased;
      positionRef.current = next;
      setPosition(next);
      if (t < 1) {
        snapAnimRef.current = requestAnimationFrame(tick);
      } else {
        snapAnimRef.current = null;
        setPositionClamped(target);
        setInteracting(false);
        emitSelection(target);
      }
    };
    snapAnimRef.current = requestAnimationFrame(tick);
  }, [
    emitSelection,
    itemCount,
    setPositionClamped,
    stopMomentum,
    stopSnap,
  ]);

  const startMomentum = useCallback(
    (initialVelocityItemsPerSec: number) => {
      if (itemCount <= 1) return;
      stopMomentum();
      stopSnap();
      setInteracting(true);
      velocityRef.current = initialVelocityItemsPerSec;
      lastTickRef.current = null;

      const tick = (now: number) => {
        const last = lastTickRef.current ?? now;
        lastTickRef.current = now;
        const dt = Math.min(0.05, (now - last) / 1000);

        positionRef.current += velocityRef.current * dt;
        velocityRef.current *= COVER_FLOW_MOMENTUM_FRICTION ** (dt * 60);

        if (positionRef.current < 0) {
          positionRef.current = 0;
          velocityRef.current = 0;
        } else if (positionRef.current > maxIndex) {
          positionRef.current = maxIndex;
          velocityRef.current = 0;
        }

        setPosition(positionRef.current);

        if (Math.abs(velocityRef.current) > COVER_FLOW_MOMENTUM_MIN_VELOCITY) {
          momentumAnimRef.current = requestAnimationFrame(tick);
        } else {
          momentumAnimRef.current = null;
          velocityRef.current = 0;
          snapToNearest();
        }
      };

      momentumAnimRef.current = requestAnimationFrame(tick);
    },
    [itemCount, maxIndex, snapToNearest, stopMomentum, stopSnap],
  );

  const finishDrag = useCallback(() => {
    const samples = dragSamplesRef.current;
    dragAnchorXRef.current = null;
    dragSamplesRef.current = [];

    if (itemCount <= 1) {
      setInteracting(false);
      return;
    }

    const pxPerMs = estimateCoverFlowReleaseVelocityPxPerMs(samples);
    const itemsPerSec = (-pxPerMs * 1000) / pixelsPerItem;

    if (Math.abs(itemsPerSec) < 0.25) {
      snapToNearest();
      return;
    }

    startMomentum(Math.max(-36, Math.min(36, itemsPerSec)));
  }, [itemCount, pixelsPerItem, snapToNearest, startMomentum]);

  const recordDrag = useCallback(
    (clientX: number) => {
      const anchorX = dragAnchorXRef.current;
      if (anchorX == null) return;

      const now = performance.now();
      dragSamplesRef.current.push({ x: clientX, t: now });
      if (dragSamplesRef.current.length > 12) {
        dragSamplesRef.current.shift();
      }

      const deltaItems = -(clientX - anchorX) / pixelsPerItem;
      setPositionClamped(dragAnchorPositionRef.current + deltaItems);
    },
    [pixelsPerItem, setPositionClamped],
  );

  const beginDrag = useCallback(
    (clientX: number) => {
      stopMomentum();
      stopSnap();
      setInteracting(true);
      dragAnchorXRef.current = clientX;
      dragAnchorPositionRef.current = positionRef.current;
      dragSamplesRef.current = [{ x: clientX, t: performance.now() }];
    },
    [stopMomentum, stopSnap],
  );

  const setIndex = useCallback(
    (index: number) => {
      stopMomentum();
      stopSnap();
      setInteracting(false);
      setPositionClamped(index);
      emitSelection(index);
    },
    [emitSelection, setPositionClamped, stopMomentum, stopSnap],
  );

  const shiftPosition = useCallback(
    (delta: number) => {
      if (delta === 0) return;
      suppressSelectionRef.current = true;
      stopMomentum();
      stopSnap();
      positionRef.current += delta;
      setPosition(positionRef.current);
      suppressSelectionRef.current = false;
    },
    [stopMomentum, stopSnap],
  );

  useEffect(() => {
    suppressSelectionRef.current = true;
    stopMomentum();
    stopSnap();
    const frame = requestAnimationFrame(() => {
      setInteracting(false);
      setPositionClamped(selectedIndex);
      suppressSelectionRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedIndex, setPositionClamped, stopMomentum, stopSnap]);

  useEffect(
    () => () => {
      stopMomentum();
      stopSnap();
    },
    [stopMomentum, stopSnap],
  );

  const viewportHandlers = {
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      beginDrag(event.clientX);
    },
    onMouseMove: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (dragAnchorXRef.current == null) return;
      recordDrag(event.clientX);
    },
    onMouseUp: () => finishDrag(),
    onMouseLeave: () => {
      if (dragAnchorXRef.current != null) finishDrag();
    },
    onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => {
      const x = event.touches[0]?.clientX;
      if (x == null) return;
      beginDrag(x);
    },
    onTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => {
      if (dragAnchorXRef.current == null) return;
      const x = event.touches[0]?.clientX;
      if (x != null) recordDrag(x);
    },
    onTouchEnd: () => finishDrag(),
    onTouchCancel: () => finishDrag(),
  };

  const safeIndex =
    itemCount > 0 ? Math.min(Math.max(0, Math.round(position)), maxIndex) : 0;

  return {
    position,
    safeIndex,
    interacting,
    viewportHandlers,
    setIndex,
    shiftPosition,
    stopMomentum,
    stopSnap,
  };
}
