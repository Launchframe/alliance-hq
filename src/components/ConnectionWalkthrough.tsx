"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  formatConnectionString,
  maskConnectionString,
  parseConnectionInput,
  type ParsedConnection,
} from "@/lib/connectionString";
import { Kbd, KbdCombo, KbdOr } from "@/components/ui/Kbd";
import { ConnectStepScreenshot } from "@/components/ConnectStepScreenshot";
import {
  CopyConnectMethodStep,
  getCopyMethodChecklistKey,
  getCopyMethodTitleKey,
  type CopyConnectMethod,
} from "@/components/CopyConnectMethodStep";
import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import {
  ashedLink,
  inlineCode,
  strongText,
} from "@/components/i18n/richText";
import { useRouter } from "@/i18n/navigation";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import {
  DEFAULT_EXPIRY_REMINDER_DAYS,
  formatTokenExpiryDate,
  getJwtExpiryDate,
} from "@/lib/jwt/decode";

const STEP_IDS = ["login", "devtools-network", "copy-curl", "paste"] as const;
type StepId = (typeof STEP_IDS)[number];

type Props = {
  onConnected?: (connection: ParsedConnection) => void;
};

export function ConnectionWalkthrough({ onConnected }: Props) {
  const t = useTranslations("connect");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pasteInput, setPasteInput] = useState("");
  const [originUrl, setOriginUrl] = useState(DEFAULT_ORIGIN_URL);
  const [appId, setAppId] = useState(DEFAULT_APP_ID);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<{
    ashed: AshedConnectionMeta;
    userLabel: string;
  } | null>(null);
  const [copyMethod, setCopyMethod] = useState<CopyConnectMethod>("curl");

  const stepId = STEP_IDS[stepIndex];
  const isPasteStep = stepId === "paste";

  const stepTitle = useMemo(() => {
    switch (stepId) {
      case "login":
        return t("steps.login.title");
      case "devtools-network":
        return t("steps.devtoolsNetwork.title");
      case "copy-curl":
        return t(getCopyMethodTitleKey(copyMethod));
      case "paste":
        return t("steps.paste.title");
    }
  }, [copyMethod, stepId, t]);

  const stepChecklist = useMemo(() => {
    switch (stepId) {
      case "login":
        return t("steps.login.checklist");
      case "devtools-network":
        return t("steps.devtoolsNetwork.checklist");
      case "copy-curl":
        return t(getCopyMethodChecklistKey(copyMethod));
      case "paste":
        return t("steps.paste.checklist");
      default:
        return undefined;
    }
  }, [copyMethod, stepId, t]);

  const progressTitle = (id: StepId) => {
    if (id === "copy-curl" && stepId === "copy-curl") {
      return stepTitle;
    }
    if (id === "copy-curl") {
      return t("steps.copyCurl.title");
    }
    switch (id) {
      case "login":
        return t("steps.login.title");
      case "devtools-network":
        return t("steps.devtoolsNetwork.title");
      case "paste":
        return t("steps.paste.title");
    }
  };

  const changeStep = useCallback((updater: (index: number) => number) => {
    setStepIndex((index) => {
      const nextIndex = updater(index);
      if (STEP_IDS[index] === "copy-curl" && nextIndex !== index) {
        setCopyMethod("curl");
      }
      return nextIndex;
    });
  }, []);

  const parsePreview = useMemo(() => {
    if (!pasteInput.trim()) return null;
    return parseConnectionInput(pasteInput, { appId, originUrl });
  }, [pasteInput, appId, originUrl]);

  const previewExpiry = useMemo(() => {
    if (!parsePreview?.ok) return null;
    const exp = getJwtExpiryDate(parsePreview.connection.token);
    if (!exp) return null;
    return formatTokenExpiryDate(exp, locale);
  }, [locale, parsePreview]);

  const previewConnectionString =
    parsePreview?.ok ? formatConnectionString(parsePreview.connection) : null;

  const canAdvance = !stepChecklist || checked[stepId] || isPasteStep;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    const parsed = parseConnectionInput(pasteInput, { appId, originUrl });
    if (!parsed.ok) {
      setError(parsed.error);
      setConnecting(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: pasteInput,
          appId,
          originUrl,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        ok?: boolean;
        userLabel?: string;
        ashed?: AshedConnectionMeta;
      };

      if (!res.ok) {
        setError(data.error ?? tc("connectionFailed"));
        return;
      }

      if (data.ashed && data.userLabel) {
        setConnectSuccess({ ashed: data.ashed, userLabel: data.userLabel });
        onConnected?.(parsed.connection);
        return;
      }

      onConnected?.(parsed.connection);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("connectionFailed"));
    } finally {
      setConnecting(false);
    }
  }, [appId, onConnected, originUrl, pasteInput, router, tc]);

  const renderStepBody = () => {
    switch (stepId) {
      case "login":
        return (
          <>
            <p>
              {t.rich("steps.login.body", { link: ashedLink })}
            </p>
            <p className="mt-2 text-sm text-[#8b949e]">
              {t("steps.login.storageNote")}
            </p>
          </>
        );
      case "devtools-network":
        return (
          <>
            <p>
              {t.rich("steps.devtoolsNetwork.intro", {
                network: strongText,
              })}
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
              <li>
                <strong>{t("steps.devtoolsNetwork.devToolsMac")}</strong>{" "}
                <KbdOr
                  options={[
                    <Kbd key="f12">F12</Kbd>,
                    <KbdCombo key="mac" keys={["⌥", "⌘", "I"]} />,
                  ]}
                />
              </li>
              <li>
                <strong>{t("steps.devtoolsNetwork.devToolsWin")}</strong>{" "}
                <KbdOr
                  options={[
                    <Kbd key="f12">F12</Kbd>,
                    <KbdCombo key="win" keys={["Ctrl", "Shift", "I"]} />,
                  ]}
                />
              </li>
            </ul>
            <p className="mt-3 text-sm text-[#8b949e]">
              {t.rich("steps.devtoolsNetwork.emptyListHint", {
                reports: strongText,
                code: inlineCode,
              })}
            </p>
            <ConnectStepScreenshot
              src="/help/connect/2-open-network-tab.png"
              alt={t("steps.devtoolsNetwork.screenshotAlt")}
              caption={t("steps.devtoolsNetwork.screenshotCaption")}
            />
          </>
        );
      case "copy-curl":
        return (
          <CopyConnectMethodStep
            method={copyMethod}
            onMethodChange={setCopyMethod}
          />
        );
      case "paste":
        return (
          <div className="space-y-4">
            <p>{t.rich("steps.paste.intro", { strong: strongText })}</p>
            <label className="block">
              <span className="mb-1 block text-xs text-[#8b949e]">
                {tc("pasteHere")}
              </span>
              <textarea
                rows={8}
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                placeholder={t("steps.paste.placeholder")}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">
                  {tc("appId")}
                </span>
                <input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">
                  {tc("originUrl")}
                </span>
                <input
                  value={originUrl}
                  onChange={(e) => setOriginUrl(e.target.value)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                />
              </label>
            </div>
            {parsePreview && !parsePreview.ok && (
              <p className="text-sm text-[#f85149]">{parsePreview.error}</p>
            )}
            {previewConnectionString && (
              <div>
                <span className="text-xs text-[#8b949e]">{tc("preview")}</span>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                  {maskConnectionString(previewConnectionString)}
                </pre>
                {previewExpiry && (
                  <p className="mt-2 text-xs text-[#8b949e]">
                    {t.rich("steps.paste.tokenExpires", {
                      date: () => (
                        <strong className="text-[#e6edf3]">{previewExpiry}</strong>
                      ),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        );
    }
  };

  if (connectSuccess) {
    const { ashed, userLabel } = connectSuccess;
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-[#3fb950]">
            {t("successTitle")}
          </h1>
          <p className="mt-2 text-[#8b949e]">
            {t("signedInAsBefore")}{" "}
            <strong className="text-[#e6edf3]">{userLabel}</strong>.
          </p>
        </header>

        <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-sm">
          {ashed.tokenExpiresAtFormatted ? (
            <TokenExpiryNotice
              formattedDate={ashed.tokenExpiresAtFormatted}
              reminderDays={
                ashed.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS
              }
            />
          ) : (
            <p className="text-[#8b949e]">{t("noExpiryRead")}</p>
          )}

          <button
            type="button"
            onClick={() => {
              router.push("/");
              router.refresh();
            }}
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
          >
            {t("continue")}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-[#8b949e]">
          {t.rich("subtitle", { link: ashedLink })}
        </p>
      </header>

      <ol className="mb-4 flex flex-wrap gap-2" aria-label={t("progressLabel")}>
        {STEP_IDS.map((id, i) => (
          <li
            key={id}
            className={`flex items-center gap-1.5 text-xs ${
              i === stepIndex
                ? "text-[#e6edf3]"
                : i < stepIndex
                  ? "text-[#3fb950]"
                  : "text-[#8b949e]"
            }`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[0.65rem] ${
                i === stepIndex
                  ? "border-[#58a6ff] bg-[#1f3d5c]"
                  : i < stepIndex
                    ? "border-[#238636]"
                    : "border-[#30363d] bg-[#21262d]"
              }`}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">{progressTitle(id)}</span>
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-lg font-medium">{stepTitle}</h2>
        <div className="mt-3 text-sm">{renderStepBody()}</div>

        {stepChecklist && !isPasteStep && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked[stepId] ?? false}
              onChange={(e) =>
                setChecked((prev) => ({ ...prev, [stepId]: e.target.checked }))
              }
              className="mt-1"
            />
            {stepChecklist}
          </label>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => changeStep((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50"
          >
            {tc("back")}
          </button>
          {!isPasteStep ? (
            <button
              type="button"
              onClick={() => changeStep((i) => i + 1)}
              disabled={!canAdvance}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {tc("next")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || !parsePreview?.ok}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {connecting ? tc("connecting") : tc("connect")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
