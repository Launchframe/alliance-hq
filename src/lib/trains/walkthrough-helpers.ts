export const FADE_MS = 200;
export const SCROLL_SETTLE_MS = 400;

/** Matches Tailwind `md` — walkthrough dialog is bottom-fixed below this width. */
export const MOBILE_WALKTHROUGH_BREAKPOINT_PX = 768;
export const MOBILE_DIALOG_BOTTOM_OFFSET_PX = 16;
export const MOBILE_VIEWPORT_TOP_PADDING_PX = 16;
export const MOBILE_DIALOG_CONTENT_GAP_PX = 16;

export const TRAINS_WALKTHROUGH_ANCHOR_TESTIDS = [
  "trains-server-time-notice",
  "trains-schedule-section",
  "trains-week-carousel",
  "trains-template-selector",
  "trains-schedule-view-toggle",
  "trains-guided-conductor-flow",
  "trains-guided-prerequisites",
  "trains-spin-source-view-pool",
  "trains-spin-week-btn",
  "trains-month-toolbar",
  "trains-month-toolbar-palette",
  "trains-conductor-history-view-all",
  "trains-user-settings",
] as const;

export type WalkthroughStepMode = "next" | "await-action" | "focus";

export type WalkthroughAwaitAction =
  | "week-template-applied"
  | "day-rule-changed"
  | "spin-week-finished"
  | "schedule-view-month";

export type WalkthroughStepDefinition = {
  id: string;
  targetCandidates?: readonly string[];
  resolveTargetCandidates?: (ctx: { today: string }) => readonly string[];
  required?: boolean;
  skipIfMissingTarget?: boolean;
  scrollBehavior?: "into-view" | "top" | "align-top";
  dialogDesktop: "left" | "right";
  mode: WalkthroughStepMode;
  awaitAction?: WalkthroughAwaitAction;
  messageKey:
    | "step1"
    | "step2"
    | "step3"
    | "step4"
    | "step5"
    | "step6"
    | "step7"
    | "step8"
    | "step9"
    | "step10"
    | "step11"
    | "step12";
  /** When true, auto-expand guided advanced panel on step enter. */
  expandAdvancedOnEnter?: boolean;
  /** Pulse a tap hint over the focus target. */
  showTapHint?: boolean;
};

export const WALKTHROUGH_STEPS: WalkthroughStepDefinition[] = [
  {
    id: "welcome",
    targetCandidates: ["trains-server-time-notice"],
    required: true,
    scrollBehavior: "align-top",
    dialogDesktop: "right",
    mode: "next",
    messageKey: "step1",
  },
  {
    id: "week-template",
    targetCandidates: ["trains-template-selector"],
    required: true,
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    mode: "await-action",
    awaitAction: "week-template-applied",
    messageKey: "step2",
  },
  {
    id: "day-long-press",
    resolveTargetCandidates: ({ today }) => [`trains-week-day-${today}`],
    required: true,
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    mode: "focus",
    awaitAction: "day-rule-changed",
    messageKey: "step3",
  },
  {
    id: "guided-pick",
    targetCandidates: ["trains-guided-conductor-flow"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    mode: "next",
    messageKey: "step4",
  },
  {
    id: "guided-conductor",
    targetCandidates: ["trains-guided-prerequisites"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    mode: "next",
    messageKey: "step5",
    skipIfMissingTarget: true,
  },
  {
    id: "view-pool",
    targetCandidates: ["trains-spin-source-view-pool"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    mode: "next",
    messageKey: "step6",
    skipIfMissingTarget: true,
  },
  {
    id: "spin-week",
    targetCandidates: ["trains-spin-week-btn"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    mode: "await-action",
    awaitAction: "spin-week-finished",
    messageKey: "step7",
    expandAdvancedOnEnter: true,
    skipIfMissingTarget: true,
  },
  {
    id: "month-view",
    targetCandidates: ["trains-schedule-view-toggle"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    mode: "focus",
    awaitAction: "schedule-view-month",
    messageKey: "step8",
    showTapHint: true,
  },
  {
    id: "month-palette",
    targetCandidates: ["trains-month-toolbar-palette"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    mode: "next",
    messageKey: "step9",
    skipIfMissingTarget: true,
  },
  {
    id: "history",
    targetCandidates: ["trains-conductor-history-view-all"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    mode: "next",
    messageKey: "step10",
    skipIfMissingTarget: true,
  },
  {
    id: "settings",
    targetCandidates: ["trains-user-settings"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    mode: "next",
    messageKey: "step11",
  },
  {
    id: "done",
    scrollBehavior: "top",
    dialogDesktop: "right",
    mode: "next",
    messageKey: "step12",
  },
];

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

export function snapshotCapabilities(today: string): Set<string> {
  const capabilities = new Set<string>();
  for (const step of WALKTHROUGH_STEPS) {
    const candidates =
      step.resolveTargetCandidates?.({ today }) ?? step.targetCandidates ?? [];
    for (const testId of candidates) {
      if (document.querySelector(`[data-testid="${testId}"]`)) {
        capabilities.add(testId);
      }
    }
  }
  for (const testId of TRAINS_WALKTHROUGH_ANCHOR_TESTIDS) {
    if (document.querySelector(`[data-testid="${testId}"]`)) {
      capabilities.add(testId);
    }
  }
  return capabilities;
}

export function resolveStepTargetCandidates(
  step: WalkthroughStepDefinition,
  today: string,
): string[] {
  return [
    ...(step.resolveTargetCandidates?.({ today }) ?? step.targetCandidates ?? []),
  ];
}

export function filterWalkthroughSteps(
  steps: readonly WalkthroughStepDefinition[],
  capabilities: ReadonlySet<string>,
  today: string,
): WalkthroughStepDefinition[] {
  return steps.filter((step) => {
    const candidates = resolveStepTargetCandidates(step, today);
    if (candidates.length === 0) {
      return true;
    }

    const hasTarget = candidates.some((id) => capabilities.has(id));

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

export type FocusRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function measureFocusRect(
  candidates: string[],
  padding = 8,
): FocusRect | null {
  const el = findTargetElement(candidates);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top - padding),
    left: Math.max(0, rect.left - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}
