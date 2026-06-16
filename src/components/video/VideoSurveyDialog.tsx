"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  jobId: string;
  file: File;
  open: boolean;
  onClose: () => void;
};

type SurveyAnswers = {
  rowCountEstimate: string;
  scrollStyle: string;
  aboveAverageScroll: string; // "yes" | "no" | ""
};

export function VideoSurveyDialog({ jobId, file, open, onClose }: Props) {
  const t = useTranslations("videoSurvey");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({
    rowCountEstimate: "",
    scrollStyle: "",
    aboveAverageScroll: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
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

  if (!open) return null;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const rowCount = parseInt(answers.rowCountEstimate, 10);
      await fetch(`/api/tools/video-upload/${jobId}/survey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowCountEstimate: Number.isFinite(rowCount) ? rowCount : null,
          scrollStyle: answers.scrollStyle || null,
          aboveAverageScroll:
            answers.aboveAverageScroll === "yes"
              ? true
              : answers.aboveAverageScroll === "no"
                ? false
                : null,
        }),
      });
    } finally {
      setSubmitting(false);
      onClose();
    }
  }

  function handleSkip() {
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-[#30363d] bg-[#161b22] p-6">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-[#e6edf3]">{t("title")}</h2>
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-[#8b949e] hover:text-[#e6edf3]"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[#8b949e]">{t("processingNote")}</p>

        {objectUrl ? (
          <video
            ref={videoRef}
            src={objectUrl}
            controls
            muted
            className="max-h-48 w-full rounded-lg border border-[#30363d] bg-black object-contain"
          />
        ) : null}

        <div className="space-y-4">
          {/* Q1: row count estimate */}
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[#e6edf3]">{t("q1Label")}</span>
            <input
              type="number"
              min={1}
              max={9999}
              value={answers.rowCountEstimate}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, rowCountEstimate: e.target.value }))
              }
              placeholder={t("q1Placeholder")}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#8b949e]"
            />
          </label>

          {/* Q2: scroll style */}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-[#e6edf3]">{t("q2Label")}</legend>
            <div className="flex flex-wrap gap-2">
              {(["slow_steady", "fast", "page_by_page", "chaotic"] as const).map((style) => (
                <label key={style} className="flex cursor-pointer items-center gap-2 text-sm text-[#e6edf3]">
                  <input
                    type="radio"
                    name="scrollStyle"
                    value={style}
                    checked={answers.scrollStyle === style}
                    onChange={() =>
                      setAnswers((prev) => ({ ...prev, scrollStyle: style }))
                    }
                    className="accent-[#58a6ff]"
                  />
                  {t(`scrollStyle.${style}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Q3: above average scroll */}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-[#e6edf3]">{t("q3Label")}</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-[#e6edf3]">
                <input
                  type="radio"
                  name="aboveAvg"
                  value="yes"
                  checked={answers.aboveAverageScroll === "yes"}
                  onChange={() =>
                    setAnswers((prev) => ({ ...prev, aboveAverageScroll: "yes" }))
                  }
                  className="accent-[#58a6ff]"
                />
                {t("q3Yes")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[#e6edf3]">
                <input
                  type="radio"
                  name="aboveAvg"
                  value="no"
                  checked={answers.aboveAverageScroll === "no"}
                  onChange={() =>
                    setAnswers((prev) => ({ ...prev, aboveAverageScroll: "no" }))
                  }
                  className="accent-[#58a6ff]"
                />
                {t("q3No")}
              </label>
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
          >
            {t("skip")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
