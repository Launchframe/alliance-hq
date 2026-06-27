import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

import { getDiscordUserLocale, upsertDiscordUserLocale } from "@/lib/vr/repository";

export type DiscordBotLocale = "en-US" | "pt-BR";

const MESSAGES: Record<DiscordBotLocale, Record<string, unknown>> = {
  "en-US": enUS.discordBot as Record<string, unknown>,
  "pt-BR": ptBR.discordBot as Record<string, unknown>,
};

const AUTHORIZE_MESSAGES: Record<DiscordBotLocale, Record<string, unknown>> = {
  "en-US": enUS.discordAuthorize as Record<string, unknown>,
  "pt-BR": ptBR.discordAuthorize as Record<string, unknown>,
};

export function normalizeDiscordBotLocale(value: string | undefined): DiscordBotLocale {
  if (!value) return "en-US";
  const lower = value.toLowerCase();
  if (lower.startsWith("pt")) return "pt-BR";
  return "en-US";
}

export async function getDiscordBotLocale(
  discordUserId: string,
  payloadLocale?: string,
): Promise<DiscordBotLocale> {
  const stored = await getDiscordUserLocale(discordUserId);
  if (stored) return stored;
  return normalizeDiscordBotLocale(payloadLocale);
}

export async function setDiscordBotLocale(
  discordUserId: string,
  locale: DiscordBotLocale,
): Promise<void> {
  await upsertDiscordUserLocale(discordUserId, locale);
}

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

export function t(
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

export function tStringArray(locale: DiscordBotLocale, key: string): string[] {
  const bucket = MESSAGES[locale] ?? MESSAGES["en-US"];
  const value = getNestedValue(bucket, key);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as string[];
  }
  const fallback = getNestedValue(MESSAGES["en-US"], key);
  if (Array.isArray(fallback) && fallback.every((entry) => typeof entry === "string")) {
    return fallback as string[];
  }
  return [];
}

export type DiscordTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export function createDiscordTranslator(locale: DiscordBotLocale): DiscordTranslate {
  return (key, params) => t(locale, key, params);
}

export function tDiscordAuthorize(
  locale: DiscordBotLocale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const bucket = AUTHORIZE_MESSAGES[locale] ?? AUTHORIZE_MESSAGES["en-US"];
  const value = getNestedValue(bucket, key);
  if (typeof value === "string") {
    return interpolate(value, params);
  }
  const fallback = getNestedValue(AUTHORIZE_MESSAGES["en-US"], key);
  if (typeof fallback === "string") {
    return interpolate(fallback, params);
  }
  return key;
}

export function parseLanguageChoice(value: string | undefined): DiscordBotLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "english" || normalized === "en" || normalized === "en-us") {
    return "en-US";
  }
  if (
    normalized === "português" ||
    normalized === "portugues" ||
    normalized === "pt" ||
    normalized === "pt-br"
  ) {
    return "pt-BR";
  }
  return null;
}
