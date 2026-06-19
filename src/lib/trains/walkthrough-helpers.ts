export const FADE_MS = 200;
export const SCROLL_SETTLE_MS = 400;

/** Matches Tailwind `md` — walkthrough dialog is bottom-fixed below this width. */
export const MOBILE_WALKTHROUGH_BREAKPOINT_PX = 768;
export const MOBILE_DIALOG_BOTTOM_OFFSET_PX = 16;
export const MOBILE_VIEWPORT_TOP_PADDING_PX = 16;
export const MOBILE_DIALOG_CONTENT_GAP_PX = 16;

export const TRAINS_WALKTHROUGH_ANCHOR_TESTIDS = [
  "trains-schedule-section",
  "trains-week-strip",
  "trains-template-selector",
  "trains-schedule-view-toggle",
  "trains-conductor-card",
  "trains-quick-actions",
  "trains-spin-week-btn",
] as const;

export function isMobileWalkthroughViewport(viewportWidth: number): boolean {
  return viewportWidth < MOBILE_WALKTHROUGH_BREAKPOINT_PX;
}

export function computeMobileScrollDeltaForFixedDialog({
  targetTop,
  targetBottom,
  targetHeight,
  viewportHeight,
  dialogHeight,
  bottomOffset = MOBILE_DIALOG_BOTTOM_OFFSET_PX,
  topPadding = MOBILE_VIEWPORT_TOP_PADDING_PX,
  gapAboveDialog = MOBILE_DIALOG_CONTENT_GAP_PX,
}: {
  targetTop: number;
  targetBottom: number;
  targetHeight: number;
  viewportHeight: number;
  dialogHeight: number;
  bottomOffset?: number;
  topPadding?: number;
  gapAboveDialog?: number;
}): number {
  void targetHeight;
  const maxVisibleBottom =
    viewportHeight - dialogHeight - bottomOffset - gapAboveDialog;
  const minVisibleTop = topPadding;

  if (maxVisibleBottom <= minVisibleTop) {
    return 0;
  }

  if (targetBottom > maxVisibleBottom) {
    return targetBottom - maxVisibleBottom;
  }

  if (targetTop < minVisibleTop) {
    return targetTop - minVisibleTop;
  }

  return 0;
}

export function computeMobileScrollDeltaAlignTop({
  targetTop,
  topPadding = MOBILE_VIEWPORT_TOP_PADDING_PX,
}: {
  targetTop: number;
  topPadding?: number;
}): number {
  return targetTop - topPadding;
}

export function mobileWalkthroughScrollPaddingPx(dialogHeight: number): number {
  return (
    dialogHeight +
    MOBILE_DIALOG_BOTTOM_OFFSET_PX +
    MOBILE_DIALOG_CONTENT_GAP_PX
  );
}

export function computeMobileScrollTopForStep({
  scrollTop,
  targetTop,
  targetBottom,
  targetHeight,
  viewportHeight,
  dialogHeight,
  scrollToTopFirst = false,
}: {
  scrollTop: number;
  targetTop: number;
  targetBottom: number;
  targetHeight: number;
  viewportHeight: number;
  dialogHeight: number;
  scrollToTopFirst?: boolean;
}): number {
  const baseScrollTop = scrollToTopFirst ? 0 : scrollTop;
  const delta = computeMobileScrollDeltaForFixedDialog({
    targetTop,
    targetBottom,
    targetHeight,
    viewportHeight,
    dialogHeight,
  });
  return Math.max(0, baseScrollTop + delta);
}

export function findTargetElement(candidates: string[]): Element | null {
  for (const testId of candidates) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) return el;
  }
  return null;
}

export function snapshotCapabilities(): Set<string> {
  const capabilities = new Set<string>();
  for (const testId of TRAINS_WALKTHROUGH_ANCHOR_TESTIDS) {
    if (document.querySelector(`[data-testid="${testId}"]`)) {
      capabilities.add(testId);
    }
  }
  return capabilities;
}

export type WalkthroughStepDefinition = {
  id: string;
  targetCandidates?: readonly string[];
  required?: boolean;
  skipIfMissingTarget?: boolean;
};

export function filterWalkthroughSteps<T extends WalkthroughStepDefinition>(
  steps: readonly T[],
  capabilities: ReadonlySet<string>,
): T[] {
  return steps.filter((step) => {
    if (!step.targetCandidates?.length) {
      return true;
    }

    const hasTarget = step.targetCandidates.some((id) => capabilities.has(id));

    if (step.skipIfMissingTarget && !hasTarget) {
      return false;
    }

    if (step.required && !hasTarget) {
      return false;
    }

    if (!step.required && !hasTarget) {
      return false;
    }

    return true;
  });
}
