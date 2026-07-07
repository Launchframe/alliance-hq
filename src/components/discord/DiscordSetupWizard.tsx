"use client";

import { signIn } from "next-auth/react";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { Link } from "@/i18n/navigation";

type Props = {
  initialTag: string;
  hasDiscordLink: boolean;
  installConfigured: boolean;
};

type WizardStep = "discord" | "tag" | "ashed" | "bot" | "done";

export function DiscordSetupWizard({
  initialTag,
  hasDiscordLink: initialHasDiscordLink,
  installConfigured,
}: Props) {
  const t = useTranslations("discordSetup");
  const [hasDiscordLink, setHasDiscordLink] = useState(initialHasDiscordLink);
  const [tag, setTag] = useState(initialTag);
  const [allianceId, setAllianceId] = useState<string | null>(null);
  const [installSessionNonce, setInstallSessionNonce] = useState<string | null>(
    null,
  );
  const [ashedConnected, setAshedConnected] = useState(false);
  const [skipAshed, setSkipAshed] = useState(false);
  const [botLoading, setBotLoading] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);

  const step: WizardStep = useMemo(() => {
    if (!hasDiscordLink) return "discord";
    if (!tag.trim()) return "tag";
    if (!ashedConnected && !skipAshed) return "ashed";
    return "bot";
  }, [ashedConnected, hasDiscordLink, skipAshed, tag]);

  const connectExtraBody = useMemo(
    () => ({
      tag: tag.trim(),
      ...(installSessionNonce ? { installSessionNonce } : {}),
    }),
    [installSessionNonce, tag],
  );

  const handleAshedSuccess = useCallback((data: Record<string, unknown>) => {
    const nextAllianceId =
      typeof data.allianceId === "string" ? data.allianceId.trim() : "";
    if (nextAllianceId) {
      setAllianceId(nextAllianceId);
    }
    setAshedConnected(true);
  }, []);

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
      };
      if (!res.ok || !data.ok || !data.installUrl) {
        setBotError(data.error ?? t("botInstallError"));
        return;
      }
      if (data.installSessionNonce) {
        setInstallSessionNonce(data.installSessionNonce);
      }
      window.location.href = data.installUrl;
    } catch {
      setBotError(t("botInstallError"));
    } finally {
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
              onClick={() =>
                void signIn("discord", { callbackUrl: "/discord/setup" })
              }
              className="mt-4 flex w-full items-center justify-center rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 sm:w-auto"
            >
              {t("steps.discord.button")}
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
            <p className="mt-3 whitespace-pre-line text-sm text-[#8b949e]">
              {t("steps.ashed.nativeSkipped")}
            </p>
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
                onClick={() => setSkipAshed(true)}
                className="mt-4 text-sm text-[#58a6ff] hover:underline"
              >
                {t("steps.ashed.skipNative")}
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
              ) : (
                <button
                  type="button"
                  disabled={botLoading || !tag.trim()}
                  onClick={() => void startBotInstall()}
                  className="inline-flex rounded-lg border border-[#5865F2] bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {botLoading ? t("steps.bot.loading") : t("steps.bot.button")}
                </button>
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
