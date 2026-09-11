"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PlanNotificationSettings } from "@/lib/plunder-plan/types.shared";

export function PlunderPlanNotifications({ settings, busy, onSave }: { settings: PlanNotificationSettings[]; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const t = useTranslations("plunderPlan");
  const [selected, setSelected] = useState(settings[0]?.guildId ?? "");
  const setting = settings.find((row) => row.guildId === selected);
  return <section className="space-y-3">
    <h2 className="text-lg font-semibold">{t("notifications.title")}</h2>
    <p>{t("notifications.digestHint")}</p>
    <label className="block">{t("notifications.guild")}<select aria-label={t("notifications.guild")} className="block w-full rounded border border-hq-border bg-hq-canvas p-2" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy}>{settings.map((row) => <option value={row.guildId} key={row.guildId}>{t("notifications.guildOption", { id: row.guildId.slice(-4) })}</option>)}</select></label>
    {setting ? <SettingsForm key={setting.guildId} initial={setting} busy={busy} onSave={onSave} /> : <p>{t("notifications.noGuilds")}</p>}
  </section>;
}

function SettingsForm({ initial, busy, onSave }: { initial: PlanNotificationSettings; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const t = useTranslations("plunderPlan");
  const locale = useLocale();
  const languages = new Intl.DisplayNames([locale], { type: "language" });
  const [draft, setDraft] = useState(initial);
  const style = "block w-full rounded border border-hq-border bg-hq-canvas p-2";
  return <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); await onSave({ action: "notifications", guildId: draft.guildId, channelId: draft.channelId, timeSt: draft.timeSt, locale: draft.locale, enabled: draft.enabled, expectedVersion: draft.version }); }}>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />{t("notifications.enableDigest")}</label>
    <label className="block">{t("notifications.channel")}<input className={style} enterKeyHint="send" disabled={busy} value={draft.channelId} pattern="[0-9]{15,25}" required={draft.enabled} onChange={(event) => setDraft({ ...draft, channelId: event.target.value })} /></label>
    <label className="block">{t("notifications.time")}<input className={style} type="time" enterKeyHint="send" disabled={busy} required value={draft.timeSt} onChange={(event) => setDraft({ ...draft, timeSt: event.target.value.slice(0, 5) })} /></label>
    <label className="block">{t("notifications.language")}<select aria-label={t("notifications.language")} className={style} disabled={busy} value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value as "en-US" | "pt-BR" })}><option value="en-US">{languages.of("en-US")}</option><option value="pt-BR">{languages.of("pt-BR")}</option></select></label>
    <button className="min-h-11 rounded border border-hq-border px-4 py-2" disabled={busy}>{t("save")}</button>
  </form>;
}
