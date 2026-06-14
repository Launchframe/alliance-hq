"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Dialog } from "@/components/ui/dialog";
import { ExperienceFeedbackDialog } from "@/components/feedback/ExperienceFeedbackDialog";
import { FeedbackFab } from "@/components/feedback/FeedbackFab";
import { ReportIssueDialog } from "@/components/feedback/ReportIssueDialog";
import { TranslationCorrectionOverlay } from "@/components/feedback/TranslationCorrectionOverlay";
import type { SurveyFeedbackSource } from "@/lib/feedback/constants";

type ExperienceOptions = {
  videoJobId?: string;
  source?: SurveyFeedbackSource;
  isSolicited?: boolean;
  delayMs?: number;
};

type FeedbackContextValue = {
  showExperienceFeedback: (options?: ExperienceOptions) => void;
  showReportIssue: () => void;
  startTranslationCorrection: () => void;
};

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null);

export function useFeedback() {
  const ctx = React.useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useFeedback must be used within FeedbackProvider");
  }
  return ctx;
}

function shouldHideFab(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/connect") ||
    pathname.startsWith("/privacy")
  );
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const locale = useLocale();

  const [experienceOpen, setExperienceOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [translationMode, setTranslationMode] = React.useState(false);
  const [experienceOptions, setExperienceOptions] =
    React.useState<ExperienceOptions>({});
  const delayTimerRef = React.useRef<number | null>(null);

  const hideFab =
    shouldHideFab(pathname) ||
    experienceOpen ||
    reportOpen ||
    translationMode;

  const showExperienceFeedback = React.useCallback(
    (options: ExperienceOptions = {}) => {
      if (delayTimerRef.current) {
        window.clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      setExperienceOptions(options);
      if (options.delayMs && options.delayMs > 0) {
        delayTimerRef.current = window.setTimeout(() => {
          setExperienceOpen(true);
        }, options.delayMs);
        return;
      }
      setExperienceOpen(true);
    },
    [],
  );

  React.useEffect(
    () => () => {
      if (delayTimerRef.current) window.clearTimeout(delayTimerRef.current);
    },
    [],
  );

  const value = React.useMemo(
    () => ({
      showExperienceFeedback,
      showReportIssue: () => setReportOpen(true),
      startTranslationCorrection: () => setTranslationMode(true),
    }),
    [showExperienceFeedback],
  );

  function openDiscord() {
    const url = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    window.alert("Discord invite URL is not configured.");
  }

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <FeedbackFab
        visible={!hideFab}
        onReportBug={() => setReportOpen(true)}
        onCorrectTranslation={() => setTranslationMode(true)}
        onLeaveFeedback={() =>
          showExperienceFeedback({ source: "unsolicited", isSolicited: false })
        }
        onGetInTouch={openDiscord}
      />

      <TranslationCorrectionOverlay
        key={translationMode ? "on" : "off"}
        active={translationMode}
        onActiveChange={setTranslationMode}
      />

      <Dialog
        open={experienceOpen}
        onOpenChange={setExperienceOpen}
        title="Experience feedback"
      >
        <ExperienceFeedbackDialog
          videoJobId={experienceOptions.videoJobId}
          source={experienceOptions.source ?? "unsolicited"}
          isSolicited={experienceOptions.isSolicited ?? false}
          locale={locale}
          pagePath={pathname}
          onClose={() => setExperienceOpen(false)}
        />
      </Dialog>

      <Dialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        ignoreOutsideDismiss={false}
        title="Report a bug"
      >
        <ReportIssueDialog onClose={() => setReportOpen(false)} />
      </Dialog>
    </FeedbackContext.Provider>
  );
}
