import type {
  BugReportArea,
  SurveyFeedbackSource,
} from "@/lib/feedback/constants";

export type ExperienceFeedbackPayload = {
  feedbackId?: string;
  videoJobId?: string;
  source?: SurveyFeedbackSource;
  isSolicited?: boolean;
  positiveExperience?: boolean;
  feedback?: string;
  outreachConsent?: boolean;
  isComplete?: boolean;
  dismissed?: boolean;
  locale?: string;
  pagePath?: string;
  appVersion?: string;
  browserVersion?: string;
  osVersion?: string;
};

export type BugReportCaptureSessionResponse = {
  sessionId: string;
  token: string;
  expiresAt: number;
};

export async function submitExperienceFeedback(
  body: ExperienceFeedbackPayload,
): Promise<{ id: string } | null> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ id: string }>;
}

export async function createBugReportCaptureSession(): Promise<BugReportCaptureSessionResponse> {
  const res = await fetch("/api/feedback/bug-reports/capture-session", {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<BugReportCaptureSessionResponse>;
}

export async function submitBugReport(input: {
  description: string;
  subject?: string;
  area?: BugReportArea;
  severity?: number;
  pageUrl?: string;
  locale?: string;
  appVersion?: string;
  browserVersion?: string;
  osVersion?: string;
  consoleLogs?: string;
  captureSessionId?: string;
  captureSessionToken?: string;
  captureSessionExpiresAt?: number;
  screenshots: Array<{
    blob: Blob;
    width: number;
    height: number;
  }>;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.set("description", input.description);
  if (input.subject) form.set("subject", input.subject);
  if (input.area) form.set("area", input.area);
  if (input.severity != null) form.set("severity", String(input.severity));
  if (input.pageUrl) form.set("pageUrl", input.pageUrl);
  if (input.locale) form.set("locale", input.locale);
  if (input.appVersion) form.set("appVersion", input.appVersion);
  if (input.browserVersion) form.set("browserVersion", input.browserVersion);
  if (input.osVersion) form.set("osVersion", input.osVersion);
  if (input.consoleLogs) form.set("consoleLogs", input.consoleLogs);
  if (input.captureSessionId) {
    form.set("captureSessionId", input.captureSessionId);
    form.set("captureSessionToken", input.captureSessionToken ?? "");
    form.set(
      "captureSessionExpiresAt",
      String(input.captureSessionExpiresAt ?? ""),
    );
  }

  input.screenshots.forEach((shot, index) => {
    form.append("screenshots", shot.blob, `screenshot-${index}.png`);
    form.set(`screenshotWidth_${index}`, String(shot.width));
    form.set(`screenshotHeight_${index}`, String(shot.height));
  });

  const res = await fetch("/api/feedback/bug-reports", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Bug report failed");
  }

  return res.json() as Promise<{ id: string }>;
}

export async function submitTranslationReport(body: {
  locale: string;
  displayedText: string;
  suggestedTranslation: string;
  pagePath?: string;
  i18nKey?: string | null;
  candidateKeys?: string[];
}): Promise<{ id: string }> {
  const res = await fetch("/api/feedback/translation-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Translation report failed");
  }
  return res.json() as Promise<{ id: string }>;
}
