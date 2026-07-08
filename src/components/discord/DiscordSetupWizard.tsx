"use client";

import { signIn } from "next-auth/react";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { discordServerLink } from "@/components/i18n/richText";
import { Link } from "@/i18n/navigation";

type Props = {
  initialTag: string;
  hasDiscordLink: boolean;
  installConfigured: boolean;
};

type WizardStep = "discord" | "tag" | "ashed" | "bot" | "done";

type AllianceSetupPhase =
  | "idle"
  | "loading"
  | "needsRequest"
  | "requestPending"
  | "allianceReady";

type AllianceStatusResponse = {
  ok?: boolean;
  allianceReady?: boolean;
  allianceId?: string;
  setupRequest?: {
    id: string;
    status: string;
    tag: string;
    allianceName: string;
    gameServerNumber: number;
  };
};

type SetupRequestResponse = {
  ok?: boolean;
  code?: string;
  allianceReady?: boolean;
  allianceId?: string;
  setupRequest?: AllianceStatusResponse["setupRequest"];
};

function mapSetupPhase(data: AllianceStatusResponse): AllianceSetupPhase {
  if (data.allianceReady && data.allianceId) {
    return "allianceReady";
  }
  if (data.setupRequest?.status === "open") {
    return "requestPending";
  }
  return "needsRequest";
}

export function DiscordSetupWizard({
  initialTag,
  hasDiscordLink: initialHasDiscordLink,
  installConfigured,
}: Props) {
  const t = useTranslations("discordSetup");
  const tErrors = useTranslations("discordSetup.errors");
  const [hasDiscordLink] = useState(initialHasDiscordLink);
  const [tag, setTag] = useState(initialTag);
  const [allianceId, setAllianceId] = useState<string | null>(null);
  const [pendingAllianceId, setPendingAllianceId] = useState<string | null>(
    null,
  );
  const [installSessionNonce, setInstallSessionNonce] = useState<string | null>(
    null,
  );
  const [ashedConnected, setAshedConnected] = useState(false);
  const [skipAshed, setSkipAshed] = useState(false);
  const [setupPhase, setSetupPhase] = useState<AllianceSetupPhase>("idle");
  const [allianceName, setAllianceName] = useState("");
  const [gameServerNumber, setGameServerNumber] = useState("");
  const [setupFormError, setSetupFormError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [botLoading, setBotLoading] = useState(false);
  const [discordLinking, setDiscordLinking] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);

  const step: WizardStep = useMemo(() => {
    if (!hasDiscordLink) return "discord";
    if (!tag.trim()) return "tag";
    if (!ashedConnected && !skipAshed) return "ashed";
    if (skipAshed && !allianceId) return "ashed";
    return "bot";
  }, [allianceId, ashedConnected, hasDiscordLink, skipAshed, tag]);

  const connectExtraBody = useMemo(
    () => ({
      tag: tag.trim(),
      ...(installSessionNonce ? { installSessionNonce } : {}),
    }),
    [installSessionNonce, tag],
  );

  const refreshAllianceSetupStatus = useCallback(async () => {
    const trimmedTag = tag.trim();
    if (!trimmedTag || !hasDiscordLink) {
      return;
    }

    setSetupPhase("loading");
    setSetupFormError(null);
    setStatusChecking(true);
    try {
      const res = await fetch(
        `/api/discord/setup/alliance-status?tag=${encodeURIComponent(trimmedTag)}`,
      );
      const data = (await res.json()) as AllianceStatusResponse;
      if (!res.ok || !data.ok) {
        setSetupPhase("needsRequest");
        return;
      }

      if (data.allianceReady && data.allianceId) {
        setPendingAllianceId(data.allianceId);
        setSetupPhase("allianceReady");
        return;
      }

      setPendingAllianceId(null);
      setSetupPhase(mapSetupPhase(data));
    } catch {
      setSetupPhase("needsRequest");
    } finally {
      setStatusChecking(false);
    }
  }, [hasDiscordLink, tag]);

  const handleAshedSuccess = useCallback((data: Record<string, unknown>) => {
    const nextAllianceId =
      typeof data.allianceId === "string" ? data.allianceId.trim() : "";
    if (nextAllianceId) {
      setAllianceId(nextAllianceId);
    }
    setAshedConnected(true);
  }, []);

  function resolveBotInstallError(data: { code?: string; error?: string }) {
    if (data.code === "alliance_not_ready") {
      return tErrors("allianceNotReady");
    }
    if (data.code === "tag_not_eligible") {
      return tErrors("tagNotEligible", { tag: tag.trim() });
    }
    return data.error ?? t("botInstallError");
  }

  function resolveSetupErrorCode(code?: string) {
    if (code === "provision_request_open") {
      return tErrors("provisionRequestOpen");
    }
    if (code === "tag_not_eligible") {
      return tErrors("tagNotEligible", { tag: tag.trim() });
    }
    return t("steps.allianceSetup.submitFailed");
  }

  async function submitSetupRequest() {
    const trimmedName = allianceName.trim();
    const parsedServer = Number(gameServerNumber.trim());
    if (!trimmedName || !gameServerNumber.trim()) {
      setSetupFormError(t("steps.allianceSetup.fieldsRequired"));
      return;
    }
    if (
      !Number.isInteger(parsedServer) ||
      parsedServer <= 0 ||
      parsedServer > 9999
    ) {
      setSetupFormError(t("steps.allianceSetup.serverNumberInvalid"));
      return;
    }

    setSetupBusy(true);
    setSetupFormError(null);
    setSetupSuccess(null);
    try {
      const res = await fetch("/api/discord/setup/alliance-setup-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: tag.trim(),
          allianceName: trimmedName,
          gameServerNumber: parsedServer,
        }),
      });
      const data = (await res.json()) as SetupRequestResponse;
      if (!res.ok || !data.ok) {
        setSetupFormError(resolveSetupErrorCode(data.code));
        return;
      }

      if (data.allianceReady && data.allianceId) {
        setPendingAllianceId(data.allianceId);
        setSetupPhase("allianceReady");
        return;
      }

      setSetupSuccess(t("steps.allianceSetup.submitSuccess"));
      setSetupPhase("requestPending");
    } catch {
      setSetupFormError(t("steps.allianceSetup.submitFailed"));
    } finally {
      setSetupBusy(false);
    }
  }

  function continueToBotInstall() {
    if (pendingAllianceId) {
      setAllianceId(pendingAllianceId);
    }
  }

  async function startBotInstall() {
    setBotLoading(true);
    setBotError(null);
    try {
      const res = await fetch("/api/discord/setup/bot-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: tag.trim(),
          allianceId: allianceId ?? undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        installUrl?: string;
        installSessionNonce?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok || !data.ok || !data.installUrl) {
        setBotError(resolveBotInstallError(data));
        setBotLoading(false);
        return;
      }
      if (data.installSessionNonce) {
        setInstallSessionNonce(data.installSessionNonce);
      }
      window.location.href = data.installUrl;
    } catch {
      setBotError(t("botInstallError"));
      setBotLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
        <p className="text-sm leading-relaxed text-[#8b949e]">{t("subtitle")}</p>
      </header>

      <ol className="space-y-6">
        <li
          className={`rounded-xl border p-5 ${
            step === "discord"
              ? "border-[#58a6ff]/60 bg-[#161b22]"
              : hasDiscordLink
                ? "border-[#238636]/40 bg-[#161b22]/60"
                : "border-[#30363d] bg-[#161b22]/40"
          }`}
        >
          <h2 className="font-medium text-[#e6edf3]">{t("steps.discord.title")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("steps.discord.body")}</p>
          {hasDiscordLink ? (
            <p className="mt-3 text-sm text-[#3fb950]">{t("steps.discord.done")}</p>
          ) : (
            <button
              type="button"
              disabled={discordLinking}
              onClick={() => {
                setDiscordLinking(true);
                void signIn("discord", { callbackUrl: "/discord/setup" });
              }}
              className="mt-4 flex w-full items-center justify-center rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {discordLinking ? t("steps.discord.linking") : t("steps.discord.button")}
            </button>
          )}
        </li>

        <li
          className={`rounded-xl border p-5 ${
            step === "tag"
              ? "border-[#58a6ff]/60 bg-[#161b22]"
              : tag.trim()
                ? "border-[#238636]/40 bg-[#161b22]/60"
                : "border-[#30363d] bg-[#161b22]/40 opacity-80"
          }`}
        >
          <h2 className="font-medium text-[#e6edf3]">{t("steps.tag.title")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("steps.tag.body")}</p>
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#8b949e]">
              {t("steps.tag.label")}
            </span>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onBlur={() => {
                if (skipAshed && tag.trim()) {
                  void refreshAllianceSetupStatus();
                }
              }}
              disabled={!hasDiscordLink}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm uppercase text-[#e6edf3] disabled:opacity-50"
              placeholder="LFgo"
            />
          </label>
        </li>

        <li
          className={`rounded-xl border p-5 ${
            step === "ashed"
              ? "border-[#58a6ff]/60 bg-[#161b22]"
              : ashedConnected || skipAshed
                ? "border-[#238636]/40 bg-[#161b22]/60"
                : "border-[#30363d] bg-[#161b22]/40 opacity-80"
          }`}
        >
          <h2 className="font-medium text-[#e6edf3]">{t("steps.ashed.title")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("steps.ashed.body")}</p>

          {skipAshed ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-[#8b949e]">
                {t.rich("steps.ashed.allianceNotOnHq", { link: discordServerLink })}
              </p>

              {setupPhase === "loading" ? (
                <p className="text-sm text-[#8b949e]">
                  {t("steps.allianceSetup.checkingAgain")}
                </p>
              ) : setupPhase === "allianceReady" ? (
                <div className="space-y-3">
                  <p className="text-sm text-[#3fb950]">
                    {t("steps.allianceSetup.allianceReady")}
                  </p>
                  <button
                    type="button"
                    onClick={continueToBotInstall}
                    className="inline-flex rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    {t("steps.allianceSetup.continueButton")}
                  </button>
                </div>
              ) : setupPhase === "requestPending" ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-[#e6edf3]">
                    {t("steps.allianceSetup.pendingTitle")}
                  </h3>
                  <p className="text-sm text-[#8b949e]">
                    {t.rich("steps.allianceSetup.pendingBody", {
                      tag: tag.trim(),
                      link: discordServerLink,
                    })}
                  </p>
                  {setupSuccess ? (
                    <p className="text-sm text-[#3fb950]">{setupSuccess}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={statusChecking}
                    onClick={() => void refreshAllianceSetupStatus()}
                    className="inline-flex rounded-lg border border-[#30363d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:border-[#58a6ff] disabled:opacity-50"
                  >
                    {statusChecking
                      ? t("steps.allianceSetup.checkingAgain")
                      : t("steps.allianceSetup.checkAgainButton")}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
                  <div>
                    <h3 className="text-sm font-medium text-[#e6edf3]">
                      {t("steps.allianceSetup.title")}
                    </h3>
                    <p className="mt-1 text-sm text-[#8b949e]">
                      {t("steps.allianceSetup.body")}
                    </p>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                      {t("steps.allianceSetup.allianceNameLabel")}
                    </span>
                    <input
                      type="text"
                      value={allianceName}
                      onChange={(e) => setAllianceName(e.target.value)}
                      placeholder={t("steps.allianceSetup.allianceNamePlaceholder")}
                      className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                      {t("steps.allianceSetup.serverNumberLabel")}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={gameServerNumber}
                      onChange={(e) =>
                        setGameServerNumber(e.target.value.replace(/\D/g, ""))
                      }
                      className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
                    />
                    <span className="mt-1 block text-xs text-[#8b949e]">
                      {t("steps.allianceSetup.serverNumberHint")}
                    </span>
                  </label>
                  {setupFormError ? (
                    <p className="text-sm text-[#f85149]" role="alert">
                      {setupFormError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={setupBusy}
                    onClick={() => void submitSetupRequest()}
                    className="inline-flex rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {setupBusy
                      ? t("steps.allianceSetup.submitting")
                      : t("steps.allianceSetup.submitButton")}
                  </button>
                </div>
              )}
            </div>
          ) : ashedConnected ? (
            <p className="mt-3 text-sm text-[#3fb950]">{t("steps.ashed.done")}</p>
          ) : hasDiscordLink && tag.trim() ? (
            <>
              <div className="mt-4 rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
                <ConnectionWalkthrough
                  skipLinkPhoneStep
                  connectApiUrl="/api/discord/setup/ashed"
                  connectApiExtraBody={connectExtraBody}
                  onConnectApiSuccess={handleAshedSuccess}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSkipAshed(true);
                  if (tag.trim()) {
                    void refreshAllianceSetupStatus();
                  }
                }}
                className="mt-4 text-sm text-[#58a6ff] hover:underline"
              >
                {t("steps.ashed.skipImport")}
              </button>
            </>
          ) : null}
        </li>

        <li
          className={`rounded-xl border p-5 ${
            step === "bot"
              ? "border-[#58a6ff]/60 bg-[#161b22]"
              : "border-[#30363d] bg-[#161b22]/40 opacity-80"
          }`}
        >
          <h2 className="font-medium text-[#e6edf3]">{t("steps.bot.title")}</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-[#8b949e]">
            {t("steps.bot.body")}
          </p>
          {step === "bot" ? (
            <div className="mt-4 space-y-3">
              {!installConfigured ? (
                <p className="text-sm text-[#f85149]">{t("steps.bot.unavailable")}</p>
              ) : allianceId ? (
                <button
                  type="button"
                  disabled={botLoading || !tag.trim()}
                  onClick={() => void startBotInstall()}
                  className="inline-flex rounded-lg border border-[#5865F2] bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {botLoading ? t("steps.bot.loading") : t("steps.bot.button")}
                </button>
              ) : (
                <p className="text-sm text-[#8b949e]">
                  {t("steps.allianceSetup.botBlockedHint")}
                </p>
              )}
              {botError ? (
                <p className="text-sm text-[#f85149]">{botError}</p>
              ) : null}
            </div>
          ) : null}
        </li>
      </ol>

      <p className="text-sm text-[#8b949e]">
        <Link href="/guides/getting-started" className="text-[#58a6ff] hover:underline">
          {t("guideLink")}
        </Link>
      </p>
    </div>
  );
}
