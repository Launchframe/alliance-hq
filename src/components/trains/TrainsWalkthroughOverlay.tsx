"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";

import { useSuppressFeedbackFabWhile } from "@/components/feedback";
import {
  FADE_MS,
  SCROLL_SETTLE_MS,
  computeMobileScrollDeltaAlignTop,
  computeMobileScrollTopForStep,
  filterWalkthroughSteps,
  findTargetElement,
  isMobileWalkthroughViewport,
  mobileWalkthroughScrollPaddingPx,
  snapshotCapabilities,
} from "@/lib/trains/walkthrough-helpers";

const DIALOG_WIDTH = 320;
const STORAGE_KEY = "trains_walkthrough_seen";

type DialogVisibility = "hidden" | "visible" | "preparing";

type WalkthroughStep = {
  id: string;
  targetCandidates?: string[];
  required?: boolean;
  scrollBehavior?: "into-view" | "top" | "align-top";
  dialogDesktop: "left" | "right";
  messageKey:
    | "stepServerTime"
    | "stepSchedule"
    | "stepWeekStrip"
    | "stepTemplate"
    | "stepViewToggle"
    | "stepConductorCard"
    | "stepQuickActions"
    | "stepSpinWeek";
  skipIfMissingTarget?: boolean;
};

const STEPS: WalkthroughStep[] = [
  {
    id: "server-time",
    targetCandidates: ["trains-server-time-notice"],
    required: true,
    scrollBehavior: "align-top",
    dialogDesktop: "right",
    messageKey: "stepServerTime",
  },
  {
    id: "schedule",
    targetCandidates: ["trains-schedule-section"],
    required: true,
    scrollBehavior: "align-top",
    dialogDesktop: "right",
    messageKey: "stepSchedule",
  },
  {
    id: "week-strip",
    targetCandidates: ["trains-week-strip"],
    required: true,
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    messageKey: "stepWeekStrip",
  },
  {
    id: "template",
    targetCandidates: ["trains-template-selector"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    messageKey: "stepTemplate",
  },
  {
    id: "view-toggle",
    targetCandidates: ["trains-schedule-view-toggle"],
    scrollBehavior: "into-view",
    dialogDesktop: "left",
    messageKey: "stepViewToggle",
  },
  {
    id: "conductor-card",
    targetCandidates: ["trains-conductor-card"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    messageKey: "stepConductorCard",
  },
  {
    id: "quick-actions",
    targetCandidates: ["trains-quick-actions"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    messageKey: "stepQuickActions",
  },
  {
    id: "spin-week",
    targetCandidates: ["trains-spin-week-btn"],
    scrollBehavior: "into-view",
    dialogDesktop: "right",
    messageKey: "stepSpinWeek",
    skipIfMissingTarget: true,
  },
];

type Props = {
  open: boolean;
  dashboardReady: boolean;
  onComplete: () => void;
};

function getWindowScrollTop(): number {
  return window.scrollY || document.documentElement.scrollTop;
}

export function trainsWalkthroughSeen(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function markTrainsWalkthroughSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, "1");
}

export function TrainsWalkthroughOverlay({
  open,
  dashboardReady,
  onComplete,
}: Props) {
  const t = useTranslations("trains.walkthrough");
  useSuppressFeedbackFabWhile(open);
  const [stepIndex, setStepIndex] = useState(0);
  const [domCapabilities, setDomCapabilities] = useState<Set<string>>(new Set());
  const [dialogStyle, setDialogStyle] = useState<React.CSSProperties>({});
  const [visibility, setVisibility] = useState<DialogVisibility>("hidden");
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const advanceInFlightRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setDomCapabilities(snapshotCapabilities());
    }, 300);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      document.body.style.paddingBottom = "";
    };
  }, []);

  const activeSteps = useMemo(() => {
    if (domCapabilities.size === 0) return [];
    return filterWalkthroughSteps(STEPS, domCapabilities);
  }, [domCapabilities]);

  const currentStep = activeSteps[stepIndex] ?? null;

  useEffect(() => {
    if (!open) return;
    if (hasInitializedRef.current) return;
    if (domCapabilities.size === 0 || !dashboardReady || activeSteps.length === 0) {
      return;
    }
    hasInitializedRef.current = true;
    const frame = requestAnimationFrame(() => {
      setVisibility("visible");
    });
    return () => cancelAnimationFrame(frame);
  }, [open, domCapabilities.size, dashboardReady, activeSteps.length]);

  const positionDialog = useCallback(() => {
    if (!currentStep || !dialogRef.current) return;

    if (isMobileWalkthroughViewport(window.innerWidth)) {
      setDialogStyle({});
      return;
    }

    const targetEl = currentStep.targetCandidates?.length
      ? findTargetElement(currentStep.targetCandidates)
      : null;
    const anchorEl =
      targetEl ??
      findTargetElement(["trains-schedule-section", "trains-conductor-card"]);

    if (!anchorEl) {
      setDialogStyle({ top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
      return;
    }

    const targetRect = anchorEl.getBoundingClientRect();
    const dialogHeight = dialogRef.current.offsetHeight || 200;
    const viewportH = window.innerHeight;
    const rawTop = targetRect.top + targetRect.height / 2 - dialogHeight / 2;
    const clampedTop = Math.max(8, Math.min(rawTop, viewportH - dialogHeight - 8));

    if (currentStep.dialogDesktop === "right") {
      setDialogStyle({
        top: clampedTop,
        left: Math.min(targetRect.right + 16, window.innerWidth - DIALOG_WIDTH - 16),
      });
    } else {
      setDialogStyle({
        top: clampedTop,
        right: Math.min(
          window.innerWidth - targetRect.left + 16,
          window.innerWidth - DIALOG_WIDTH - 16,
        ),
      });
    }
  }, [currentStep]);

  const scrollTargetForStep = useCallback((step: WalkthroughStep) => {
    const targetEl = step.targetCandidates?.length
      ? findTargetElement(step.targetCandidates)
      : null;
    const isMobile = isMobileWalkthroughViewport(window.innerWidth);
    const dialogHeight = dialogRef.current?.offsetHeight ?? 220;

    if (isMobile) {
      if (step.scrollBehavior === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (step.scrollBehavior === "align-top" && targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const delta = computeMobileScrollDeltaAlignTop({ targetTop: rect.top });
        window.scrollTo({
          top: Math.max(0, getWindowScrollTop() + delta),
          behavior: "smooth",
        });
      } else if (step.scrollBehavior === "into-view" && targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const nextScrollTop = computeMobileScrollTopForStep({
          scrollTop: getWindowScrollTop(),
          targetTop: rect.top,
          targetBottom: rect.bottom,
          targetHeight: rect.height,
          viewportHeight: window.innerHeight,
          dialogHeight,
        });
        if (nextScrollTop !== getWindowScrollTop()) {
          window.scrollTo({ top: nextScrollTop, behavior: "smooth" });
        }
      }
      return targetEl;
    }

    if (step.scrollBehavior === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (
      (step.scrollBehavior === "into-view" || step.scrollBehavior === "align-top") &&
      targetEl
    ) {
      targetEl.scrollIntoView({
        behavior: "smooth",
        block: step.scrollBehavior === "align-top" ? "start" : "center",
      });
    }

    return targetEl;
  }, []);

  useLayoutEffect(() => {
    if (!open || !currentStep) return;

    const applyPadding = () => {
      if (!isMobileWalkthroughViewport(window.innerWidth) || !open) {
        document.body.style.paddingBottom = "";
        return;
      }
      const dialogHeight = dialogRef.current?.offsetHeight ?? 0;
      if (dialogHeight <= 0) return;
      document.body.style.paddingBottom = `${mobileWalkthroughScrollPaddingPx(dialogHeight)}px`;
    };

    applyPadding();
    const dialogEl = dialogRef.current;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(applyPadding)
        : null;
    if (dialogEl && ro) ro.observe(dialogEl);
    window.addEventListener("resize", applyPadding, { passive: true });

    return () => {
      document.body.style.paddingBottom = "";
      ro?.disconnect();
      window.removeEventListener("resize", applyPadding);
    };
  }, [open, stepIndex, visibility, currentStep]);

  useLayoutEffect(() => {
    if (!open || !currentStep) return;
    scrollTargetForStep(currentStep);
    const timer = setTimeout(() => {
      positionDialog();
    }, SCROLL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [open, currentStep, scrollTargetForStep, positionDialog]);

  useEffect(() => {
    window.addEventListener("resize", positionDialog, { passive: true });
    return () => window.removeEventListener("resize", positionDialog);
  }, [positionDialog]);

  const finish = useCallback(() => {
    markTrainsWalkthroughSeen();
    document.body.style.paddingBottom = "";
    onComplete();
  }, [onComplete]);

  const advance = useCallback(() => {
    if (advanceInFlightRef.current) return;
    advanceInFlightRef.current = true;
    const isLast = stepIndex >= activeSteps.length - 1;
    setVisibility("hidden");

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      if (isLast) {
        advanceInFlightRef.current = false;
        finish();
        return;
      }

      setVisibility("preparing");
      setStepIndex((i) => i + 1);

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        advanceInFlightRef.current = false;
        setVisibility("visible");
      }, SCROLL_SETTLE_MS + 50);
    }, FADE_MS);
  }, [stepIndex, activeSteps.length, finish]);

  if (!open || domCapabilities.size === 0 || !currentStep) return null;

  const message = t(currentStep.messageKey);
  const progress =
    activeSteps.length > 1
      ? Math.round(((stepIndex + 1) / activeSteps.length) * 100)
      : 100;
  const isVisible = visibility === "visible";

  return (
    <>
      <div
        className={`pointer-events-none fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-live="polite"
        aria-label={t("stepCounter", {
          current: stepIndex + 1,
          total: activeSteps.length,
        })}
        className={`fixed z-50 rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl left-4 right-4 bottom-4 top-auto max-w-xs mx-auto md:mx-0 md:left-auto md:right-auto md:bottom-auto transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ width: DIALOG_WIDTH, ...dialogStyle }}
      >
        <div className="h-1 w-full overflow-hidden rounded-t-2xl bg-[#0d1117]">
          <div
            className="h-full bg-[#8957e5] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="p-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8b949e]">
            {t("stepCounter", {
              current: stepIndex + 1,
              total: activeSteps.length,
            })}
          </p>
          <div
            className={`transition-opacity duration-200 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="text-sm leading-relaxed text-[#e6edf3]">{message}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={finish}
                className="rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
              >
                {t("skip")}
              </button>
              <button
                type="button"
                onClick={advance}
                className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
              >
                {stepIndex < activeSteps.length - 1 ? t("next") : t("done")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
