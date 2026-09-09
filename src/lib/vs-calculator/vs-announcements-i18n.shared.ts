import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

import type { DiscordBotLocale } from "@/lib/discord/i18n";

type VsAnnouncementsMessages = Record<string, unknown>;

const MESSAGES: Record<DiscordBotLocale, VsAnnouncementsMessages> = {
  "en-US": (enUS as { vsAnnouncements: VsAnnouncementsMessages }).vsAnnouncements,
  "pt-BR": (ptBR as { vsAnnouncements: VsAnnouncementsMessages }).vsAnnouncements,
};

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] != null ? String(params[key]) : `{${key}}`,
  );
}

export function tVsAnnouncement(
  locale: DiscordBotLocale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const bucket = MESSAGES[locale] ?? MESSAGES["en-US"];
  const value = getNestedValue(bucket, key);
  if (typeof value === "string") {
    return interpolate(value, params);
  }
  const fallback = getNestedValue(MESSAGES["en-US"], key);
  if (typeof fallback === "string") {
    return interpolate(fallback, params);
  }
  return key;
}
