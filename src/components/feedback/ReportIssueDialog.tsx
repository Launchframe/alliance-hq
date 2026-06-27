"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/AppSelect";
import { Textarea } from "@/components/ui/textarea";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  handleTextareaEnterSubmit,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import {
  APP_VERSION,
  BUG_REPORT_AREAS,
  BUG_REPORT_SEVERITY_OPTIONS,
  MAX_BUG_REPORT_SCREENSHOTS,
  clientContextPayload,
  inferBugReportArea,
  revokeCapturedScreenshotUrls,
  type CapturedScreenshot,
} from "@/lib/feedback/constants";
import {
  createBugReportCaptureSession,
  submitBugReport,
  type BugReportCaptureSessionResponse,
} from "@/lib/feedback/client-api";
import {
  formatBugReportConsoleLogs,
  installBugReportConsoleCapture,
  uninstallBugReportConsoleCapture,
} from "@/lib/feedback/bug-report-console-capture";
import { ScreenshotModeOverlay } from "@/components/feedback/ScreenshotModeOverlay";

const DISCORD_ICON_SRC =
  "/discord-communication-interaction-message-network.svg";

type Props = {
  onClose: () => void;
  onSubmitSuccess?: () => void;
  onScreenshotModeChange?: (open: boolean) => void;
  onScreenshotPreviewOpenChange?: (open: boolean) => void;
  onJoinDiscord?: () => void;
};

export function ReportIssueDialog({
  onClose,
  onSubmitSuccess,
  onScreenshotModeChange,
  onScreenshotPreviewOpenChange,
  onJoinDiscord,
}: Props) {
  const t = useTranslations("feedback.bugReport");
  const locale = useLocale();
  const pathname = usePathname();
  const ctx = clientContextPayload();

  const [area, setArea] = React.useState(() => inferBugReportArea(pathname));
  const [severity, setSeverity] = React.useState(2);
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [screenshots, setScreenshots] = React.useState<CapturedScreenshot[]>([]);
  const [captureSession, setCaptureSession] =
    React.useState<BugReportCaptureSessionResponse | null>(null);
  const [screenshotModeOpen, setScreenshotModeOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [expandedScreenshotId, setExpandedScreenshotId] = React.useState<
    string | null
  >(null);
  const [isPreviewMounted] = React.useState(() => typeof document !== "undefined");

  const expandedScreenshot = expandedScreenshotId
    ? screenshots.find((shot) => shot.id === expandedScreenshotId)
    : undefined;

  React.useEffect(() => {
    onScreenshotPreviewOpenChange?.(Boolean(expandedScreenshot));
  }, [expandedScreenshot, onScreenshotPreviewOpenChange]);

  React.useEffect(() => {
    if (!expandedScreenshot) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpandedScreenshotId(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expandedScreenshot]);

  const closeScreenshotPreview = React.useCallback(() => {
    onScreenshotPreviewOpenChange?.(false);
    setExpandedScreenshotId(null);
  }, [onScreenshotPreviewOpenChange]);

  React.useEffect(() => {
    installBugReportConsoleCapture();
    return () => uninstallBugReportConsoleCapture();
  }, []);

  React.useEffect(
    () => () => revokeCapturedScreenshotUrls(screenshots),
    [screenshots],
  );

  React.useEffect(() => {
    onScreenshotModeChange?.(screenshotModeOpen);
  }, [onScreenshotModeChange, screenshotModeOpen]);

  React.useEffect(
    () => () => {
      onScreenshotModeChange?.(false);
    },
    [onScreenshotModeChange],
  );

  async function ensureCaptureSession() {
    if (captureSession) return captureSession;
    const session = await createBugReportCaptureSession();
    setCaptureSession(session);
    return session;
  }

  async function handleTakeScreenshot() {
    await ensureCaptureSession();
    setScreenshotModeOpen(true);
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError(t("descriptionRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = screenshots.length > 0 ? await ensureCaptureSession() : null;
      await submitBugReport({
        description: description.trim(),
        subject: subject.trim() || undefined,
        area,
        severity,
        pageUrl: `${pathname}`,
        locale,
        appVersion: APP_VERSION,
        browserVersion: ctx.browserVersion,
        osVersion: ctx.osVersion,
        consoleLogs: formatBugReportConsoleLogs(),
        captureSessionId: session?.sessionId,
        captureSessionToken: session?.token,
        captureSessionExpiresAt: session?.expiresAt,
        screenshots: screenshots.map(({ blob, width, height }) => ({
          blob,
          width,
          height,
        })),
      });
      setSubmitted(true);
      onSubmitSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <h2 className="text-lg font-semibold">{t("thankYouTitle")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("thankYouDescription")}</p>
        </div>

        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-6 text-center">
          <img
            src={DISCORD_ICON_SRC}
            alt=""
            aria-hidden
            className="mx-auto h-20 w-20"
          />
          <p className="mt-4 text-sm leading-relaxed text-[#e6edf3]">
            {t("discordFollowUp")}
          </p>
          {onJoinDiscord ? (
            <Button className="mt-4" onClick={onJoinDiscord}>
              {t("joinDiscord")}
            </Button>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("done")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void handleSubmit();
        }}
      >
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("area")}</span>
          <AppSelect
            value={area}
            onChange={(next) => setArea(next as typeof area)}
            aria-label={t("area")}
            options={BUG_REPORT_AREAS.map((value) => ({
              value,
              label: t(`areas.${value}`),
            }))}
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("severity")}</span>
          <AppSelect
            value={String(severity)}
            onChange={(next) => setSeverity(Number(next))}
            aria-label={t("severity")}
            options={BUG_REPORT_SEVERITY_OPTIONS.map((option) => ({
              value: String(option.value),
              label: t(option.labelKey),
            }))}
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("subject")}</span>
          <input
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("details")}</span>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            onKeyDown={(e) =>
              handleTextareaEnterSubmit(e, () => {
                void handleSubmit();
              })
            }
            placeholder={t("detailsPlaceholder")}
          />
        </label>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {screenshots.map((shot) => (
              <button
                key={shot.id}
                type="button"
                className="overflow-hidden rounded border border-[#30363d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
                aria-label={t("viewScreenshotFullSize")}
                onClick={() => setExpandedScreenshotId(shot.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.previewUrl}
                  alt={t("screenshotThumbnailAlt")}
                  className="h-16 w-16 object-cover"
                />
              </button>
            ))}
          </div>
          {screenshots.length < MAX_BUG_REPORT_SCREENSHOTS ? (
            <Button variant="outline" onClick={handleTakeScreenshot}>
              {t("takeScreenshot")}
            </Button>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </form>

      <ScreenshotModeOverlay
        open={screenshotModeOpen}
        onClose={() => setScreenshotModeOpen(false)}
        onCapture={(shot) => {
          setScreenshots((prev) => [...prev, shot].slice(0, MAX_BUG_REPORT_SCREENSHOTS));
        }}
      />

      {isPreviewMounted && expandedScreenshot
        ? createPortal(
            <div
              className="fixed inset-0 z-[250] flex items-center justify-center bg-black/90 p-4"
              data-bug-report-screenshot-preview
              role="dialog"
              aria-modal="true"
              aria-label={t("screenshotPreview")}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) {
                  closeScreenshotPreview();
                }
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto absolute right-4 top-4 z-[251] h-11 w-11 rounded-full border-2 border-white/90 bg-black/70 text-white shadow-lg hover:border-white hover:bg-black/90 hover:text-white"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  closeScreenshotPreview();
                }}
                aria-label={t("closePreview")}
              >
                <X className="h-6 w-6" strokeWidth={2.75} />
              </Button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={expandedScreenshot.previewUrl}
                alt={t("screenshotPreview")}
                className="max-h-full max-w-full object-contain"
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
