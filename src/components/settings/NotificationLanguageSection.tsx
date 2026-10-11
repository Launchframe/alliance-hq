"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { locales, type AppLocale } from "@/i18n/routing";
import {
  USER_LOCALE_AUTOMATIC,
  type UserLocaleResolution,
} from "@/lib/i18n/user-locale.shared";

export type NotificationLanguageState = {
  manual: AppLocale | null;
  automatic: UserLocaleResolution;
};

export function NotificationLanguageSection({
  initial,
}: {
  initial: NotificationLanguageState;
}) {
  const t = useTranslations("account");
  const tLanguage = useTranslations("language");
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    const previous = state;
    setState({
      ...state,
      manual: next === USER_LOCALE_AUTOMATIC ? null : (next as AppLocale),
    });
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/language", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        manual?: AppLocale | null;
        automatic?: UserLocaleResolution;
      };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      if (body.automatic) {
        setState({ manual: body.manual ?? null, automatic: body.automatic });
      }
    } catch (err) {
      setState(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <h2 className="font-medium">{t("communicationsSection")}</h2>
      <p className="mt-2 text-sm text-hq-fg-muted">{t("communicationsBody")}</p>
      <label className="mt-4 block text-sm">
        <span className="mb-2 block text-hq-fg-muted">
          {t("notificationLanguageLabel")}
        </span>
        <AppSelect
          value={state.manual ?? USER_LOCALE_AUTOMATIC}
          onChange={(next) => void save(next)}
          disabled={saving}
          aria-label={t("notificationLanguageLabel")}
          options={[
            {
              value: USER_LOCALE_AUTOMATIC,
              label: t("notificationLanguageAutomatic", {
                language: tLanguage(state.automatic.locale),
              }),
            },
            ...locales.map((code) => ({ value: code, label: tLanguage(code) })),
          ]}
        />
      </label>
      {state.manual ? null : (
        <p className="mt-2 text-xs text-hq-fg-muted">
          {state.automatic.source === "lastrank"
            ? t("notificationLanguageHintLastRank")
            : t("notificationLanguageHintDefault")}
        </p>
      )}
      {error ? <p className="mt-2 text-sm text-hq-danger">{error}</p> : null}
    </section>
  );
}
