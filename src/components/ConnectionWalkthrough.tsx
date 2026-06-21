"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AlliancePicker } from "@/components/AlliancePicker";
import { ConnectStepScreenshot } from "@/components/ConnectStepScreenshot";
import {
  CopyConnectMethodStep,
  getCopyMethodChecklistKey,
  getCopyMethodTitleKey,
  type CopyConnectMethod,
} from "@/components/CopyConnectMethodStep";
import { LinkPhoneStep } from "@/components/credential-pairing/LinkPhoneStep";
import { Checkbox } from "@/components/ui/checkbox";
import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import {
  ashedLink,
  inlineCode,
  strongText,
} from "@/components/i18n/richText";
import { useRouter, Link } from "@/i18n/navigation";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import type { AccessibleAlliance } from "@/lib/alliance/types";
import {
  DEFAULT_EXPIRY_REMINDER_DAYS,
  formatTokenExpiryDate,
  getJwtExpiryDate,
} from "@/lib/jwt/decode";
import {
  getContinueToHqLabelKey,
  shouldShowAlliancePicker,
} from "@/lib/credential-pairing/link-phone-phase";
import {
  markConnectWalkthroughSeen,
  readConnectWalkthroughSeen,
} from "@/lib/connect/walkthrough.shared";

const STEP_IDS = [
  "login",
  "devtools-network",
  "copy-curl",
  "paste",
  "link-phone",
] as const;
type StepId = (typeof STEP_IDS)[number];

const LINK_PHONE_STEP_INDEX = STEP_IDS.indexOf("link-phone");
const PASTE_STEP_INDEX = STEP_IDS.indexOf("paste");

type Props = {
  onConnected?: (connection: ParsedConnection) => void;
  /** Skip login / DevTools / copy steps for returning Ashed users. */
  skipWalkthroughToPaste?: boolean;
  /** Returning reconnect with a phone already linked — skip optional link-phone step. */
  skipLinkPhoneStep?: boolean;
};

export function ConnectionWalkthrough({
  onConnected,
  skipWalkthroughToPaste = false,
  skipLinkPhoneStep = false,
}: Props) {
  const t = useTranslations("connect");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(() =>
    skipWalkthroughToPaste ? PASTE_STEP_INDEX : 0,
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pasteInput, setPasteInput] = useState("");
  const [originUrl, setOriginUrl] = useState(DEFAULT_ORIGIN_URL);
  const [appId, setAppId] = useState(DEFAULT_APP_ID);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<{
    ashed: AshedConnectionMeta;
    userLabel: string;
    alliance?: { id: string; tag: string; name?: string };
  } | null>(null);
  const [phoneLinked, setPhoneLinked] = useState(false);
  const [phoneLinkSkipped, setPhoneLinkSkipped] = useState(false);
  const [copyMethod, setCopyMethod] = useState<CopyConnectMethod>("curl");
  const [accessibleAlliances, setAccessibleAlliances] = useState<
    AccessibleAlliance[]
  >([]);
  const [selectedAllianceId, setSelectedAllianceId] = useState("");
  const [alliancesLoading, setAlliancesLoading] = useState(false);
  const [alliancesError, setAlliancesError] = useState<string | null>(null);

  const stepId = STEP_IDS[stepIndex];
  const isPasteStep = stepId === "paste";
  const isLinkPhoneStep = stepId === "link-phone";
  const isPasteSuccess = isPasteStep && connectSuccess !== null;
  const [returningUser, setReturningUser] = useState(skipWalkthroughToPaste);
  const visibleStepIds = skipLinkPhoneStep
    ? STEP_IDS.filter((id) => id !== "link-phone")
    : STEP_IDS;

  useEffect(() => {
    if (skipWalkthroughToPaste || !readConnectWalkthroughSeen()) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setStepIndex(PASTE_STEP_INDEX);
      setReturningUser(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [skipWalkthroughToPaste]);

  const stepTitle = useMemo(() => {
    switch (stepId) {
      case "login":
        return t("steps.login.title");
      case "devtools-network":
        return t("steps.devtoolsNetwork.title");
      case "copy-curl":
        return t(getCopyMethodTitleKey(copyMethod));
      case "paste":
        return isPasteSuccess
          ? t("setupComplete.title")
          : t("steps.paste.title");
      case "link-phone":
        return t("steps.linkPhone.title");
    }
  }, [copyMethod, isPasteSuccess, stepId, t]);

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
      case "link-phone":
        return t("steps.linkPhone.title");
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

  const continueToApp = useCallback(() => {
    router.push("/");
    router.refresh();
  }, [router]);

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

  const alliancesForUi = useMemo(
    () => (parsePreview?.ok ? accessibleAlliances : []),
    [accessibleAlliances, parsePreview?.ok],
  );
  const selectedForUi = parsePreview?.ok ? selectedAllianceId : "";
  const showAlliancePicker = shouldShowAlliancePicker(parsePreview?.ok);

  useEffect(() => {
    if (!parsePreview?.ok) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setAlliancesLoading(true);
      setAlliancesError(null);

      try {
        const res = await fetch("/api/auth/accessible-alliances", {
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
          alliances?: AccessibleAlliance[];
          autoSelected?: AccessibleAlliance | null;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("steps.paste.allianceLoadFailed"));
        }
        if (cancelled) return;
        const alliances = data.alliances ?? [];
        setAccessibleAlliances(alliances);
        if (data.autoSelected) {
          setSelectedAllianceId(data.autoSelected.id);
        } else {
          setSelectedAllianceId("");
        }
      } catch (err) {
        if (cancelled) return;
        setAccessibleAlliances([]);
        setSelectedAllianceId("");
        setAlliancesError(
          err instanceof Error ? err.message : t("steps.paste.allianceLoadFailed"),
        );
      } finally {
        if (!cancelled) {
          setAlliancesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appId, originUrl, parsePreview?.ok, pasteInput, t]);

  const canConnect =
    !!parsePreview?.ok &&
    !alliancesLoading &&
    alliancesForUi.length > 0 &&
    (alliancesForUi.length === 1 || !!selectedForUi);

  const canAdvance =
    isPasteStep || isLinkPhoneStep || !stepChecklist || checked[stepId];

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
          allianceId:
            selectedForUi ||
            (alliancesForUi.length === 1 ? alliancesForUi[0]?.id : undefined),
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        code?: string;
        ok?: boolean;
        userLabel?: string;
        ashed?: AshedConnectionMeta;
        alliance?: { id: string; tag: string; name?: string };
      };

      if (!res.ok) {
        if (data.code === "invite_required") {
          setError(t("inviteRequired"));
          return;
        }
        setError(data.error ?? tc("connectionFailed"));
        return;
      }

      if (data.ashed && data.userLabel) {
        markConnectWalkthroughSeen();
        onConnected?.(parsed.connection);
        if (skipLinkPhoneStep) {
          router.push("/");
          router.refresh();
          return;
        }
        setConnectSuccess({
          ashed: data.ashed,
          userLabel: data.userLabel,
          alliance: data.alliance,
        });
        return;
      }

      onConnected?.(parsed.connection);
      markConnectWalkthroughSeen();
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("connectionFailed"));
    } finally {
      setConnecting(false);
    }
  }, [
    alliancesForUi,
    appId,
    onConnected,
    originUrl,
    pasteInput,
    router,
    selectedForUi,
    skipLinkPhoneStep,
    t,
    tc,
  ]);

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
            <p>{t("steps.devtoolsNetwork.intro")}</p>
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
            <p className="mt-2">
              {t.rich("steps.devtoolsNetwork.openNetworkTab", {
                network: strongText,
              })}
            </p>
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
        if (isPasteSuccess) {
          const { ashed, userLabel, alliance } = connectSuccess;

          return (
            <div className="space-y-4">
              <p className="text-[#8b949e]">
                {t("signedInAsBefore")}{" "}
                <strong className="text-[#e6edf3]">{userLabel}</strong>.
              </p>
              {alliance ? (
                <p className="text-sm text-[#8b949e]">
                  {t("allianceResolved", {
                    tag: alliance.tag,
                    name: alliance.name ?? alliance.tag,
                  })}
                </p>
              ) : null}
              {ashed.tokenExpiresAtFormatted ? (
                <TokenExpiryNotice
                  formattedDate={ashed.tokenExpiresAtFormatted}
                  reminderDays={
                    ashed.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS
                  }
                />
              ) : (
                <p className="text-sm text-[#8b949e]">{t("noExpiryRead")}</p>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-4">
            {returningUser && !isPasteSuccess ? (
              <p className="text-sm text-[#8b949e]">{t("returningUserHint")}</p>
            ) : null}
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
            {showAlliancePicker ? (
              <AlliancePicker
                alliances={alliancesForUi}
                selectedAllianceId={selectedForUi}
                onSelect={setSelectedAllianceId}
                label={t("steps.paste.alliancePickerLabel")}
                hint={t("steps.paste.alliancePickerHint")}
                emptyMessage={alliancesError ?? t("steps.paste.allianceNone")}
                loading={alliancesLoading}
                loadingMessage={t("steps.paste.allianceLoading")}
              />
            ) : null}
            <details className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm">
              <summary className="cursor-pointer text-[#e6edf3]">
                {t("steps.paste.advancedSettingsSummary")}
              </summary>
              <p className="mt-2 text-xs text-[#8b949e]">
                {t("steps.paste.advancedSettingsHint")}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
            </details>
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
      case "link-phone":
        if (phoneLinkSkipped) {
          return (
            <p className="text-sm text-[#8b949e]">
              {t.rich("steps.linkPhone.skippedBody", {
                settingsLink: (chunks) => (
                  <Link
                    href="/account"
                    className="text-[#58a6ff] hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          );
        }
        return <LinkPhoneStep onLinked={() => setPhoneLinked(true)} />;
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">
          {isPasteSuccess ? (
            <span className="text-[#3fb950]">{t("setupComplete.title")}</span>
          ) : (
            t("title")
          )}
        </h1>
        <p className="mt-2 text-[#8b949e]">
          {isPasteSuccess
            ? t("setupComplete.body")
            : t.rich("subtitle", { link: ashedLink })}
        </p>
      </header>

      <ol className="mb-4 flex flex-wrap gap-2" aria-label={t("progressLabel")}>
        {visibleStepIds.map((id, visibleIndex) => {
          const i = STEP_IDS.indexOf(id);
          return (
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
              {visibleIndex + 1}
            </span>
            <span className="hidden sm:inline">{progressTitle(id)}</span>
          </li>
          );
        })}
      </ol>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">{stepTitle}</h2>
          {isLinkPhoneStep ? (
            <span className="rounded-full border border-[#d29922]/50 bg-[#d29922]/10 px-2 py-0.5 text-xs text-[#e3b341]">
              {tc("optional")}
            </span>
          ) : null}
        </div>
        <div className="mt-3 text-sm">{renderStepBody()}</div>

        {isPasteStep && !isPasteSuccess && returningUser ? (
          <p className="mt-4 text-sm">
            <button
              type="button"
              onClick={() => setStepIndex(0)}
              className="text-[#58a6ff] hover:underline"
            >
              {t("showSetupInstructions")}
            </button>
          </p>
        ) : null}

        {stepChecklist && !isPasteStep && !isLinkPhoneStep && (
          <label
            htmlFor={`connect-step-${stepId}`}
            className="mt-4 flex cursor-pointer items-start gap-3 text-sm"
          >
            <Checkbox
              id={`connect-step-${stepId}`}
              checked={checked[stepId] ?? false}
              onCheckedChange={(value) =>
                setChecked((prev) => ({ ...prev, [stepId]: value }))
              }
              className="mt-0.5"
            />
            <span>{stepChecklist}</span>
          </label>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => changeStep((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0 || isLinkPhoneStep || isPasteSuccess}
            className="rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50"
          >
            {tc("back")}
          </button>
          {isLinkPhoneStep ? (
            <>
              {!phoneLinkSkipped && !phoneLinked ? (
                <button
                  type="button"
                  onClick={() => setPhoneLinkSkipped(true)}
                  className="rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm"
                >
                  {t("steps.linkPhone.skip")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={continueToApp}
                className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
              >
                {t(getContinueToHqLabelKey(phoneLinked))}
              </button>
            </>
          ) : isPasteSuccess ? (
            <button
              type="button"
              onClick={
                skipLinkPhoneStep
                  ? continueToApp
                  : () => setStepIndex(LINK_PHONE_STEP_INDEX)
              }
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
            >
              {t("steps.paste.continue")}
            </button>
          ) : !isPasteStep ? (
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
              disabled={connecting || !canConnect}
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
