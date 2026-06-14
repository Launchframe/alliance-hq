"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

type Props = {
  onClose: () => void;
  onSubmitSuccess?: () => void;
};

export function ReportIssueDialog({ onClose, onSubmitSuccess }: Props) {
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

  React.useEffect(() => {
    installBugReportConsoleCapture();
    return () => uninstallBugReportConsoleCapture();
  }, []);

  React.useEffect(
    () => () => revokeCapturedScreenshotUrls(screenshots),
    [screenshots],
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
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("thankYouTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("thankYouDescription")}</p>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("done")}</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-[#8b949e]">{t("description")}</p>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("area")}</span>
          <select
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            value={area}
            onChange={(e) => setArea(e.target.value as typeof area)}
          >
            {BUG_REPORT_AREAS.map((value) => (
              <option key={value} value={value}>
                {t(`areas.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("severity")}</span>
          <select
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            value={severity}
            onChange={(e) => setSeverity(Number(e.target.value))}
          >
            {BUG_REPORT_SEVERITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
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
            placeholder={t("detailsPlaceholder")}
          />
        </label>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {screenshots.map((shot) => (
              <img
                key={shot.id}
                src={shot.previewUrl}
                alt=""
                className="h-16 w-16 rounded border border-[#30363d] object-cover"
              />
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
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>

      <ScreenshotModeOverlay
        open={screenshotModeOpen}
        onClose={() => setScreenshotModeOpen(false)}
        onCapture={(shot) => {
          setScreenshots((prev) => [...prev, shot].slice(0, MAX_BUG_REPORT_SCREENSHOTS));
        }}
      />
    </>
  );
}
