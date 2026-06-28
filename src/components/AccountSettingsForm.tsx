"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PairingQrWizard } from "@/components/credential-pairing/PairingQrWizard";
import { LinkedDevicesSettings } from "@/components/credential-pairing/LinkedDevicesSettings";
import { AccountDiscordLinkSection } from "@/components/account/AccountDiscordLinkSection";
import { AppSelect } from "@/components/ui/AppSelect";
import { useAccountTimezone } from "@/components/timezone/TimezoneProvider";
import { Link, useRouter } from "@/i18n/navigation";
import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import { ashedLink, strongText } from "@/components/i18n/richText";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { DEFAULT_EXPIRY_REMINDER_DAYS } from "@/lib/jwt/decode";
import type { AccountTimezoneId } from "@/lib/timezone/constants";
import {
  ACCOUNT_TIMEZONE_OPTION_IDS,
  formatTimezoneOptionLabel,
} from "@/lib/timezone/options";

const REMINDER_OPTIONS = [7, 14, 21, 30];

type Props = {
  initialAshed: AshedConnectionMeta | null;
  initialTimezoneId?: AccountTimezoneId;
  discordLinked?: boolean;
  discordAvailable?: boolean;
  discordLinkNotice?: "linked" | "unlinked" | null;
  discordLinkError?: string | null;
};

export function AccountSettingsForm({
  initialAshed,
  initialTimezoneId,
  discordLinked = false,
  discordAvailable = false,
  discordLinkNotice = null,
  discordLinkError = null,
}: Props) {
  const t = useTranslations("account");
  const tSettings = useTranslations("settings");
  const tDevice = useTranslations("deviceLink");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { timezoneId, setTimezoneId } = useAccountTimezone();
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ashed, setAshed] = useState(initialAshed);
  const [reminderDays, setReminderDays] = useState(
    initialAshed?.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS,
  );
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [linkedDevicesRefresh, setLinkedDevicesRefresh] = useState(0);

  useEffect(() => {
    if (initialTimezoneId) {
      setTimezoneId(initialTimezoneId);
    }
  }, [initialTimezoneId, setTimezoneId]);

  async function saveTimezone(nextTimezone: AccountTimezoneId) {
    setTimezoneSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/timezone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: nextTimezone }),
      });
      const data = (await res.json()) as {
        error?: string;
        timezone?: AccountTimezoneId;
        ashed?: AshedConnectionMeta;
      };
      if (!res.ok) {
        setMessage(data.error ?? t("timezoneSaveFailed"));
        return;
      }
      if (data.timezone) {
        setTimezoneId(data.timezone);
      }
      if (data.ashed) {
        setAshed(data.ashed);
      }
      setMessage(t("timezoneSaved"));
      router.refresh();
    } catch {
      setMessage(t("timezoneSaveFailed"));
    } finally {
      setTimezoneSaving(false);
    }
  }

  async function saveReminderDays(days: number) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryReminderDays: days }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? t("reminderSaveFailed"));
        return;
      }
      const data = (await res.json()) as { ashed: AshedConnectionMeta };
      setAshed(data.ashed);
      setReminderDays(data.ashed.expiryReminderDays);
      setMessage(t("reminderSaved"));
    } catch {
      setMessage(t("reminderSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function disconnectAshed() {
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? tc("disconnectFailed"));
        return;
      }
      setAshed(null);
      setMessage(t("disconnectedAshed"));
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : tc("disconnectFailed"));
    } finally {
      setDisconnecting(false);
    }
  }

  async function signOutHq() {
    setSigningOut(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) {
        setMessage(t("signOutFailed"));
        return;
      }
      router.push("/auth");
      router.refresh();
    } catch {
      setMessage(t("signOutFailed"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{tSettings("hotkeysTitle")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{tSettings("hotkeysBody")}</p>
        <Link
          href="/settings/hotkeys"
          className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {tSettings("hotkeysLink")} →
        </Link>
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{tSettings("accountSecurityTitle")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">
          {tSettings("accountSecurityBody")}
        </p>
        <Link
          href="/settings/account"
          className="mt-4 inline-block text-sm text-[#58a6ff] hover:underline"
        >
          {tSettings("accountSecurityLink")} →
        </Link>
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("timezoneSection")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("timezoneBody")}</p>
        <label className="mt-4 block text-sm">
          <span className="mb-2 block text-[#8b949e]">{t("timezoneLabel")}</span>
          <AppSelect
            value={timezoneId}
            onChange={(next) => {
              const nextTimezone = next as AccountTimezoneId;
              setTimezoneId(nextTimezone);
              void saveTimezone(nextTimezone);
            }}
            disabled={timezoneSaving}
            aria-label={t("timezoneLabel")}
            options={ACCOUNT_TIMEZONE_OPTION_IDS.map((optionId) => ({
              value: optionId,
              label: formatTimezoneOptionLabel(
                optionId,
                locale,
                t("timezoneServerTime"),
              ),
            }))}
          />
        </label>
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("tokenSection")}</h2>
        {ashed?.tokenExpiresAtFormatted ? (
          <div className="mt-3 space-y-4">
            <TokenExpiryNotice
              formattedDate={ashed.tokenExpiresAtFormatted}
              reminderDays={reminderDays}
            />
            <label className="block text-sm">
              <span className="mb-2 block text-[#8b949e]">{t("remindMe")}</span>
              <AppSelect
                value={String(reminderDays)}
                onChange={(next) => {
                  const days = Number(next);
                  setReminderDays(days);
                  void saveReminderDays(days);
                }}
                disabled={saving}
                aria-label={t("remindMe")}
                options={REMINDER_OPTIONS.map((days) => ({
                  value: String(days),
                  label: t("reminderOption", { days }),
                }))}
              />
            </label>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-[#8b949e]">{t("reconnectHint")}</p>
            <Link
              href="/connect?next=/account"
              className="inline-block rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
            >
              {ashed ? t("reconnectAshedCta") : t("connectAshedCta")}
            </Link>
          </div>
        )}
      </section>

      <AccountDiscordLinkSection
        linked={discordLinked}
        discordAvailable={discordAvailable}
        linkNotice={discordLinkNotice}
        linkError={discordLinkError}
      />

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{tDevice("sectionTitle")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{tDevice("sectionBody")}</p>
        <p className="mt-2 text-sm text-[#8b949e]">{tDevice("storageNote")}</p>
        <div className="mt-4">
          <PairingQrWizard
            purpose="device_link"
            onLinked={() => setLinkedDevicesRefresh((value) => value + 1)}
            strings={{
              showQr: tDevice("showQr"),
              generating: tDevice("generating"),
              scanHint: tDevice("scanHint"),
              expiresIn: tDevice("expiresIn"),
              expired: tDevice("expired"),
              linked: tDevice("linked"),
              createFailed: tDevice("createFailed"),
              hideQr: tDevice("hideQr"),
            }}
          />
          <LinkedDevicesSettings refreshToken={linkedDevicesRefresh} />
        </div>
      </section>

      {ashed ? (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="font-medium">{t("disconnectSection")}</h2>
          <p className="mt-2 text-sm text-[#8b949e]">{t("disconnectBody")}</p>
          <button
            type="button"
            onClick={() => void disconnectAshed()}
            disabled={disconnecting}
            className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
          >
            {disconnecting ? t("disconnecting") : t("disconnectButton")}
          </button>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">{t("signOutSection")}</h2>
        <p className="mt-2 text-sm text-[#8b949e]">{t("signOutBody")}</p>
        <button
          type="button"
          onClick={() => void signOutHq()}
          disabled={signingOut}
          className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
        >
          {signingOut ? t("signingOut") : t("signOutButton")}
        </button>
      </section>

      {message ? (
        <p
          className={`text-sm ${
            message === t("reminderSaved") || message === t("timezoneSaved")
              ? "text-[#3fb950]"
              : "text-[#f85149]"
          }`}
        >
          {message}
        </p>
      ) : null}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-sm text-[#8b949e]">
        <p>
          {t.rich("aboutBody", {
            strong: strongText,
            link: ashedLink,
          })}
        </p>
      </section>
    </div>
  );
}
