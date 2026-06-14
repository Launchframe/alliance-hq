"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  APP_VERSION,
  clientContextPayload,
  type SurveyFeedbackSource,
} from "@/lib/feedback/constants";
import {
  submitExperienceFeedback,
  type ExperienceFeedbackPayload,
} from "@/lib/feedback/client-api";

type Props = {
  videoJobId?: string;
  source?: SurveyFeedbackSource;
  isSolicited?: boolean;
  locale: string;
  pagePath: string;
  onClose: () => void;
};

export function ExperienceFeedbackDialog({
  videoJobId,
  source = "unsolicited",
  isSolicited = false,
  locale,
  pagePath,
  onClose,
}: Props) {
  const t = useTranslations("feedback.experience");
  const [step, setStep] = React.useState(0);
  const [comments, setComments] = React.useState("");
  const [feedbackId, setFeedbackId] = React.useState<string | null>(null);
  const [positiveExperience, setPositiveExperience] = React.useState<
    boolean | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const ctx = clientContextPayload();

  const persist = React.useCallback(
    async (patch: Partial<ExperienceFeedbackPayload>) => {
      const payload: ExperienceFeedbackPayload = {
        feedbackId: feedbackId ?? undefined,
        videoJobId,
        source,
        isSolicited,
        locale,
        pagePath,
        appVersion: APP_VERSION,
        browserVersion: ctx.browserVersion,
        osVersion: ctx.osVersion,
        ...patch,
      };
      const result = await submitExperienceFeedback(payload);
      if (result?.id) setFeedbackId(result.id);
    },
    [ctx.browserVersion, ctx.osVersion, feedbackId, isSolicited, locale, pagePath, source, videoJobId],
  );

  async function handleDismiss() {
    try {
      await persist({ dismissed: true });
    } catch {
      /* ignore dismiss errors */
    }
    onClose();
  }

  async function handleRating(positive: boolean) {
    setPositiveExperience(positive);
    try {
      await persist({ positiveExperience: positive });
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    }
  }

  async function handleCommentsSubmit() {
    try {
      await persist({ feedback: comments });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    }
  }

  async function handleOutreach(consent: boolean) {
    try {
      await persist({ outreachConsent: consent, isComplete: true });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    }
  }

  const title =
    isSolicited && source === "solicited_first_upload"
      ? t("solicitedFirstTitle")
      : isSolicited && source === "solicited_third_upload"
        ? t("solicitedThirdTitle")
        : t("unsolicitedTitle");

  return (
    <div className="space-y-4">
      {step === 0 && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>
          </div>
          <div className="flex justify-center gap-4">
            <Button variant="outline" className="h-16 w-16 text-2xl" onClick={() => handleRating(true)} aria-label={t("positive")}>
              👍
            </Button>
            <Button variant="outline" className="h-16 w-16 text-2xl" onClick={() => handleRating(false)} aria-label={t("negative")}>
              👎
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleDismiss}>
              {t("notNow")}
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div>
            <h2 className="text-lg font-semibold">
              {positiveExperience ? t("commentsPositive") : t("commentsNegative")}
            </h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("commentsDescription")}</p>
          </div>
          <Textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={t("commentsPlaceholder")}
          />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={handleDismiss}>
              {t("cancel")}
            </Button>
            <Button onClick={handleCommentsSubmit}>{t("continue")}</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{t("outreachTitle")}</h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("outreachDescription")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => handleOutreach(false)}>
              {t("outreachNo")}
            </Button>
            <Button className="flex-1" onClick={() => handleOutreach(true)}>
              {t("outreachYes")}
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{t("thankYouTitle")}</h2>
            <p className="mt-1 text-sm text-[#8b949e]">{t("thankYouDescription")}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t("done")}</Button>
          </div>
        </>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
