"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ExperienceFeedbackDialog } from "@/components/feedback/ExperienceFeedbackDialog";
import { FeedbackFab } from "@/components/feedback/FeedbackFab";
import { ReportIssueDialog } from "@/components/feedback/ReportIssueDialog";
import { TranslationCorrectionOverlay } from "@/components/feedback/TranslationCorrectionOverlay";
import { TranslationSelectionTooltip } from "@/components/feedback/TranslationSelectionTooltip";
import { resolveDiscordInviteAction } from "@/lib/feedback/discord-invite";
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
  setWalkthroughFabSuppressed: (suppressed: boolean) => void;
};

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null);

export function useFeedback() {
  const ctx = React.useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useFeedback must be used within FeedbackProvider");
  }
  return ctx;
}

/** Hide the feedback FAB while a full-screen walkthrough is active (e.g. /trains). */
export function useSuppressFeedbackFabWhile(active: boolean) {
  const ctx = React.useContext(FeedbackContext);
  React.useEffect(() => {
    if (!ctx) return;
    ctx.setWalkthroughFabSuppressed(active);
    return () => ctx.setWalkthroughFabSuppressed(false);
  }, [active, ctx]);
}

function shouldHideFab(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/connect") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms")
  );
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const locale = useLocale();
  const tDiscord = useTranslations("feedback.discord");

  const [experienceOpen, setExperienceOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [translationMode, setTranslationMode] = React.useState(false);
  const [discordNoticeOpen, setDiscordNoticeOpen] = React.useState(false);
  const [reportScreenshotMode, setReportScreenshotMode] = React.useState(false);
  const [reportScreenshotPreviewOpen, setReportScreenshotPreviewOpen] =
    React.useState(false);
  const [experienceOptions, setExperienceOptions] =
    React.useState<ExperienceOptions>({});
  const [walkthroughFabSuppressed, setWalkthroughFabSuppressed] =
    React.useState(false);
  const delayTimerRef = React.useRef<number | null>(null);

  const hideFab =
    shouldHideFab(pathname) ||
    experienceOpen ||
    reportOpen ||
    reportScreenshotMode ||
    translationMode ||
    discordNoticeOpen ||
    walkthroughFabSuppressed;

  const passiveTranslationTooltipEnabled =
    locale !== "en-US" && !shouldHideFab(pathname);
  const passiveTranslationTooltipBlocked =
    translationMode ||
    experienceOpen ||
    reportOpen ||
    reportScreenshotMode ||
    reportScreenshotPreviewOpen ||
    discordNoticeOpen;

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

  function openDiscord() {
    const action = resolveDiscordInviteAction(
      process.env.NEXT_PUBLIC_DISCORD_INVITE_URL,
    );
    if (action.type === "open") {
      window.open(action.url, "_blank", "noopener,noreferrer");
      return;
    }
    setDiscordNoticeOpen(true);
  }

  const value = React.useMemo(
    () => ({
      showExperienceFeedback,
      showReportIssue: () => setReportOpen(true),
      startTranslationCorrection: () => setTranslationMode(true),
      setWalkthroughFabSuppressed,
    }),
    [showExperienceFeedback],
  );

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

      {passiveTranslationTooltipEnabled ? (
        <TranslationSelectionTooltip
          key={String(passiveTranslationTooltipBlocked)}
          blocked={passiveTranslationTooltipBlocked}
        />
      ) : null}

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
        onOpenChange={(open) => {
          if (!open && reportScreenshotPreviewOpen) return;
          setReportOpen(open);
        }}
        ignoreOutsideDismiss={reportScreenshotPreviewOpen}
        presentationHidden={reportScreenshotMode || reportScreenshotPreviewOpen}
        title="Report a bug"
      >
        <ReportIssueDialog
          onClose={() => setReportOpen(false)}
          onScreenshotModeChange={setReportScreenshotMode}
          onScreenshotPreviewOpenChange={setReportScreenshotPreviewOpen}
          onJoinDiscord={openDiscord}
        />
      </Dialog>

      <Dialog
        open={discordNoticeOpen}
        onOpenChange={setDiscordNoticeOpen}
        title={tDiscord("unavailableTitle")}
      >
        <p className="text-sm text-[#8b949e]">{tDiscord("unavailableDescription")}</p>
        <Button
          className="mt-4 w-full"
          onClick={() => setDiscordNoticeOpen(false)}
        >
          {tDiscord("dismiss")}
        </Button>
      </Dialog>
    </FeedbackContext.Provider>
  );
}
