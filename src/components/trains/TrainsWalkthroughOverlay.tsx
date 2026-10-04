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

import { TrainsWalkthroughFocusBackdrop } from "@/components/trains/TrainsWalkthroughFocusBackdrop";
import { useSuppressFeedbackFabWhile } from "@/components/feedback";
import { useTrainsWalkthrough } from "@/lib/trains/walkthrough-context";
import {
  FADE_MS,
  SCROLL_SETTLE_MS,
  WALKTHROUGH_STEPS,
  computeMobileScrollDeltaAlignTop,
  computeMobileScrollTopForStep,
  filterWalkthroughSteps,
  findTargetElement,
  isMobileWalkthroughViewport,
  mobileWalkthroughScrollPaddingPx,
  resolveStepTargetCandidates,
  snapshotCapabilities,
  type WalkthroughStepDefinition,
} from "@/lib/trains/walkthrough-helpers";

const DIALOG_WIDTH = 320;
const STORAGE_KEY = "trains_walkthrough_seen";

type DialogVisibility = "hidden" | "visible" | "preparing";

type Props = {
  open: boolean;
  dashboardReady: boolean;
  today: string;
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
  today,
  onComplete,
}: Props) {
  const t = useTranslations("trains.walkthrough");
  const walkthrough = useTrainsWalkthrough();
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
      setDomCapabilities(snapshotCapabilities(today));
    }, 300);
    return () => clearTimeout(timer);
  }, [open, today]);

  useEffect(() => {
    if (!open) {
      hasInitializedRef.current = false;
    }
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
    return filterWalkthroughSteps(WALKTHROUGH_STEPS, domCapabilities, today);
  }, [domCapabilities, today]);

  const currentStep = activeSteps[stepIndex] ?? null;

  useEffect(() => {
    walkthrough?.setCurrentStepId(currentStep?.id ?? null);
  }, [currentStep?.id, walkthrough]);

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

  const currentTargetCandidates = useMemo(
    () => (currentStep ? resolveStepTargetCandidates(currentStep, today) : []),
    [currentStep, today],
  );

  const positionDialog = useCallback(() => {
    if (!currentStep || !dialogRef.current) return;

    if (isMobileWalkthroughViewport(window.innerWidth)) {
      setDialogStyle({});
      return;
    }

    const targetEl = currentTargetCandidates.length
      ? findTargetElement(currentTargetCandidates)
      : null;
    const anchorEl =
      targetEl ??
      findTargetElement([
        "trains-schedule-section",
        "trains-guided-conductor-flow",
      ]);

    if (!anchorEl) {
      setDialogStyle({
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      });
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
        left: Math.min(
          targetRect.right + 16,
          window.innerWidth - DIALOG_WIDTH - 16,
        ),
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
  }, [currentStep, currentTargetCandidates]);

  const scrollTargetForStep = useCallback(
    (step: WalkthroughStepDefinition) => {
      const candidates = resolveStepTargetCandidates(step, today);
      const targetEl = candidates.length ? findTargetElement(candidates) : null;
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
        (step.scrollBehavior === "into-view" ||
          step.scrollBehavior === "align-top") &&
        targetEl
      ) {
        targetEl.scrollIntoView({
          behavior: "smooth",
          block: step.scrollBehavior === "align-top" ? "start" : "center",
        });
      }

      return targetEl;
    },
    [today],
  );

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

  useEffect(() => {
    if (!open || currentStep?.id !== "spin-week") return;
    const timer = setTimeout(() => {
      const toggle = document.querySelector(
        '[data-testid="trains-guided-advanced-toggle"]',
      );
      if (
        toggle instanceof HTMLButtonElement &&
        toggle.getAttribute("aria-expanded") === "false"
      ) {
        toggle.click();
      }
    }, SCROLL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [open, currentStep?.id]);

  const finish = useCallback(() => {
    markTrainsWalkthroughSeen();
    walkthrough?.resetSandbox();
    document.body.style.paddingBottom = "";
    onComplete();
  }, [onComplete, walkthrough]);

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

  useEffect(() => {
    if (!open || !currentStep?.skipIfMissingTarget) return;

    const candidates = resolveStepTargetCandidates(currentStep, today);
    if (candidates.length === 0) return;

    const timer = setTimeout(() => {
      if (!findTargetElement(candidates)) {
        advance();
      }
    }, SCROLL_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [advance, currentStep, open, today]);

  useEffect(() => {
    if (!open || !walkthrough || !currentStep?.awaitAction) return;

    return walkthrough.subscribe((action) => {
      const expected = currentStep.awaitAction;
      if (expected === "week-template-applied" && action.type === expected) {
        advance();
      } else if (expected === "day-rule-changed" && action.type === expected) {
        advance();
      } else if (expected === "spin-week-finished" && action.type === expected) {
        advance();
      } else if (expected === "schedule-view-month" && action.type === expected) {
        advance();
      }
    });
  }, [advance, currentStep?.awaitAction, open, walkthrough]);

  if (!open || domCapabilities.size === 0 || !currentStep) return null;

  const message = t(currentStep.messageKey);
  const progress =
    activeSteps.length > 1
      ? Math.round(((stepIndex + 1) / activeSteps.length) * 100)
      : 100;
  const isVisible = visibility === "visible";
  const isFocusStep = currentStep.mode === "focus";
  const isPassiveStep = currentStep.mode === "next";
  const showDimOverlay = !isFocusStep;

  return (
    <>
      {isFocusStep ? (
        <TrainsWalkthroughFocusBackdrop
          targetCandidates={currentTargetCandidates}
          showTapHint={currentStep.showTapHint}
          visible={isVisible}
        />
      ) : null}
      {showDimOverlay ? (
        <div
          className={`pointer-events-none fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden
        />
      ) : null}
      <div
        ref={dialogRef}
        role="dialog"
        aria-live="polite"
        aria-label={t("stepCounter", {
          current: stepIndex + 1,
          total: activeSteps.length,
        })}
        className={`fixed z-50 rounded-2xl border border-hq-border bg-hq-surface shadow-2xl left-4 right-4 bottom-4 top-auto max-w-xs mx-auto md:mx-0 md:left-auto md:right-auto md:bottom-auto transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ width: DIALOG_WIDTH, ...dialogStyle }}
      >
        <div className="h-1 w-full overflow-hidden rounded-t-2xl bg-hq-canvas">
          <div
            className="h-full bg-[#8957e5] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="p-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
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
            <p className="text-sm leading-relaxed text-hq-fg">{message}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={finish}
                className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas"
              >
                {t("skip")}
              </button>
              {isPassiveStep ? (
                <button
                  type="button"
                  onClick={advance}
                  className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
                >
                  {stepIndex < activeSteps.length - 1 ? t("next") : t("done")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
