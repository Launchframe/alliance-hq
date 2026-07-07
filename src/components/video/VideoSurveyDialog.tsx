"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { FORM_SUBMIT_ENTER_KEY_HINT } from "@/lib/client/form-enter-submit.shared";
import {
  SURVEY_SCROLL_STYLES,
  SURVEY_SCHOOLING_ANSWERS,
  accumulatedFromPayload,
  hasSurveyAnswers,
  isSurveyComplete,
  type SurveyAccumulated,
  type SurveyPayload,
  type SurveySchoolingAnswer,
  type SurveyScrollStyle,
  surveyResumeStep,
} from "@/lib/video/survey";

const TOTAL_STEPS = 3;

type StepDraft = {
  rowCountEstimate: string;
  scrollStyle: SurveyScrollStyle | "";
  schoolingTuitionAnswer: SurveySchoolingAnswer | "";
};

type Props = {
  jobId: string;
  file?: File | null;
  memberName?: string | null;
  open: boolean;
  onClose: (result: { complete: boolean }) => void;
  /** When set, restores wizard step and answers from a prior partial survey. */
  initialSurvey?: SurveyPayload | null;
  /** Fresh upload flow navigates to review on close; resume from list does not. */
  navigateOnClose?: boolean;
};

function isValidRowCountInput(value: string): boolean {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 9999;
}

function buildPayload(accumulated: SurveyAccumulated): SurveyPayload {
  return {
    rowCountEstimate: accumulated.rowCountEstimate,
    scrollStyle: accumulated.scrollStyle,
    schoolingTuitionAnswer: accumulated.schoolingTuitionAnswer,
    aboveAverageScroll:
      accumulated.schoolingTuitionAnswer === "yes"
        ? true
        : accumulated.schoolingTuitionAnswer === "no"
          ? false
          : null,
  };
}

function emptyAccumulated(): SurveyAccumulated {
  return {
    rowCountEstimate: null,
    scrollStyle: null,
    schoolingTuitionAnswer: null,
  };
}

export function VideoSurveyDialog({
  jobId,
  file = null,
  memberName = null,
  open,
  onClose,
  initialSurvey = null,
}: Props) {
  const t = useTranslations("videoSurvey");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<StepDraft>({
    rowCountEstimate: "",
    scrollStyle: "",
    schoolingTuitionAnswer: "",
  });
  const [accumulated, setAccumulated] = useState<SurveyAccumulated>(emptyAccumulated);
  const [submitting, setSubmitting] = useState(false);

  const storedVideoSrc = `/api/tools/video-upload/${jobId}/video`;

  useEffect(() => {
    if (!open || !file) return;
    const url = URL.createObjectURL(file);
    const raf = requestAnimationFrame(() => {
      setObjectUrl(url);
    });
    return () => {
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [open, file]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      if (initialSurvey) {
        const nextAccumulated = accumulatedFromPayload(initialSurvey);
        setAccumulated(nextAccumulated);
        setStep(surveyResumeStep(initialSurvey));
        setDraft({
          rowCountEstimate:
            nextAccumulated.rowCountEstimate != null
              ? String(nextAccumulated.rowCountEstimate)
              : "",
          scrollStyle: nextAccumulated.scrollStyle ?? "",
          schoolingTuitionAnswer: nextAccumulated.schoolingTuitionAnswer ?? "",
        });
        return;
      }

      setStep(1);
      setDraft({
        rowCountEstimate: "",
        scrollStyle: "",
        schoolingTuitionAnswer: "",
      });
      setAccumulated(emptyAccumulated());
    });
    return () => cancelAnimationFrame(raf);
  }, [open, jobId, initialSurvey]);

  function stepHasValidAnswer(currentStep: number): boolean {
    if (currentStep === 1) return isValidRowCountInput(draft.rowCountEstimate);
    if (currentStep === 2) return draft.scrollStyle !== "";
    return draft.schoolingTuitionAnswer !== "";
  }

  function mergeStepIntoAccumulated(currentStep: number): SurveyAccumulated {
    if (currentStep === 1 && isValidRowCountInput(draft.rowCountEstimate)) {
      return {
        ...accumulated,
        rowCountEstimate: parseInt(draft.rowCountEstimate, 10),
      };
    }
    if (currentStep === 2 && draft.scrollStyle) {
      return { ...accumulated, scrollStyle: draft.scrollStyle };
    }
    if (currentStep === 3 && draft.schoolingTuitionAnswer) {
      return {
        ...accumulated,
        schoolingTuitionAnswer: draft.schoolingTuitionAnswer,
      };
    }
    return accumulated;
  }

  async function postAndClose(nextAccumulated: SurveyAccumulated) {
    const payload = buildPayload(nextAccumulated);
    const complete = isSurveyComplete(payload);

    if (!hasSurveyAnswers(payload)) {
      onClose({ complete: false });
      return;
    }

    setSubmitting(true);
    try {
      await fetch(`/api/tools/video-upload/${jobId}/survey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowCountEstimate: payload.rowCountEstimate,
          scrollStyle: payload.scrollStyle,
          schoolingTuitionAnswer: payload.schoolingTuitionAnswer,
          aboveAverageScroll: payload.aboveAverageScroll,
        }),
      });
    } finally {
      setSubmitting(false);
      onClose({ complete });
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) return;
    const nextAccumulated = stepHasValidAnswer(step)
      ? mergeStepIntoAccumulated(step)
      : accumulated;
    void postAndClose(nextAccumulated);
  }

  function handleSkip() {
    if (stepHasValidAnswer(step)) {
      const nextAccumulated = mergeStepIntoAccumulated(step);
      setAccumulated(nextAccumulated);
      if (step >= TOTAL_STEPS) {
        void postAndClose(nextAccumulated);
        return;
      }
      setStep((s) => s + 1);
      setDraft((prev) => ({
        ...prev,
        rowCountEstimate:
          nextAccumulated.rowCountEstimate != null
            ? String(nextAccumulated.rowCountEstimate)
            : prev.rowCountEstimate,
        scrollStyle: nextAccumulated.scrollStyle ?? "",
        schoolingTuitionAnswer: nextAccumulated.schoolingTuitionAnswer ?? "",
      }));
      return;
    }

    if (step >= TOTAL_STEPS) {
      void postAndClose(accumulated);
      return;
    }
    setStep((s) => s + 1);
  }

  function handleNext() {
    if (!stepHasValidAnswer(step)) return;
    const nextAccumulated = mergeStepIntoAccumulated(step);
    setAccumulated(nextAccumulated);
    if (step >= TOTAL_STEPS) {
      void postAndClose(nextAccumulated);
      return;
    }
    setStep((s) => s + 1);
    setDraft((prev) => ({
      ...prev,
      scrollStyle: nextAccumulated.scrollStyle ?? "",
      schoolingTuitionAnswer: nextAccumulated.schoolingTuitionAnswer ?? "",
    }));
  }

  const q3Label =
    memberName != null ? t("q3Label", { memberName }) : t("q3LabelGeneric");

  const nextEnabled = stepHasValidAnswer(step) && !submitting;
  const videoSrc = objectUrl ?? (file ? null : storedVideoSrc);

  useEffect(() => {
    if (!open || !videoSrc) return;
    const video = videoRef.current;
    if (!video) return;

    const tryPlay = () => {
      void video.play().catch(() => {
        // Autoplay may be blocked; controls remain available.
      });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      tryPlay();
      return;
    }

    video.addEventListener("loadeddata", tryPlay, { once: true });
    return () => video.removeEventListener("loadeddata", tryPlay);
  }, [open, videoSrc]);

  function handleEnterAdvance(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("video")) return;
    if (target.tagName === "TEXTAREA" || target.isContentEditable) return;
    if (!nextEnabled) return;
    e.preventDefault();
    handleNext();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      className="max-w-xl sm:max-w-2xl"
    >
      <form
        className="flex min-w-0 flex-col gap-6 p-1 sm:p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (nextEnabled) handleNext();
        }}
        onKeyDownCapture={handleEnterAdvance}
      >
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-hq-fg">{t("title")}</h2>
          {step === 1 ? (
            <p className="mt-1 text-xs text-hq-fg-muted">{t("processingNote")}</p>
          ) : null}
        </div>

        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            autoPlay
            muted
            playsInline
            className="max-h-48 w-full min-w-0 rounded-lg border border-hq-border bg-black object-contain"
          />
        ) : null}

        <p className="text-xs font-medium text-hq-fg-muted">
          {t("stepIndicator", { current: step, total: TOTAL_STEPS })}
        </p>

        <div className="min-w-0 space-y-4">
          {step === 1 ? (
            <label className="block text-sm">
              <span className="mb-2 block font-medium text-hq-fg">
                {t("q1Label")}
              </span>
              <input
                type="number"
                min={1}
                max={9999}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                autoFocus
                value={draft.rowCountEstimate}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    rowCountEstimate: e.target.value,
                  }))
                }
                placeholder={t("q1Placeholder")}
                className="w-full min-w-0 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2.5 text-sm text-hq-fg placeholder:text-hq-fg-muted"
              />
            </label>
          ) : null}

          {step === 2 ? (
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-medium text-hq-fg">
                {t("q2Label")}
              </legend>
              <div className="flex flex-col gap-2">
                {SURVEY_SCROLL_STYLES.map((style) => {
                  const selected = draft.scrollStyle === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, scrollStyle: style }))
                      }
                      className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        selected
                          ? "border-hq-accent bg-hq-accent/10 text-hq-fg"
                          : "border-hq-border bg-hq-canvas text-hq-fg hover:border-[#484f58]"
                      }`}
                    >
                      {t(`scrollStyle.${style}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {step === 3 ? (
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-medium text-hq-fg">
                {q3Label}
              </legend>
              <div className="flex flex-col gap-2">
                {SURVEY_SCHOOLING_ANSWERS.map((answer) => {
                  const selected = draft.schoolingTuitionAnswer === answer;
                  const labelKey =
                    answer === "yes"
                      ? "q3Yes"
                      : answer === "no"
                        ? "q3No"
                        : "q3Idk";
                  return (
                    <button
                      key={answer}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          schoolingTuitionAnswer: answer,
                        }))
                      }
                      className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        selected
                          ? "border-hq-accent bg-hq-accent/10 text-hq-fg"
                          : "border-hq-border bg-hq-canvas text-hq-fg hover:border-[#484f58]"
                      }`}
                    >
                      {t(labelKey)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            {t("skip")}
          </button>
          <button
            type="submit"
            disabled={!nextEnabled}
            className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("submitting") : t("next")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
