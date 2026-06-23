import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

export type MemberLinkLocale = "en-US" | "pt-BR";

const MESSAGES: Record<MemberLinkLocale, Record<string, unknown>> = {
  "en-US": enUS.memberLink as Record<string, unknown>,
  "pt-BR": ptBR.memberLink as Record<string, unknown>,
};

function normalizeLocale(value: string | undefined): MemberLinkLocale {
  if (value?.toLowerCase().startsWith("pt")) return "pt-BR";
  return "en-US";
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

/** Compatible with DiscordTranslate — keys use `link.*` prefix from processLinkCommand. */
export function createMemberLinkTranslator(locale: string | undefined) {
  const loc = normalizeLocale(locale);
  const bucket = MESSAGES[loc];

  return function translate(
    key: string,
    params?: Record<string, string | number>,
  ): string {
    const normalizedKey = key.startsWith("link.") ? key.slice("link.".length) : key;
    const value = getNestedValue(bucket, normalizedKey);
    if (typeof value === "string") {
      return interpolate(value, params);
    }
    return key;
  };
}

export function memberLinkWalkthroughSteps(locale: string | undefined): string[] {
  const loc = normalizeLocale(locale);
  const steps = MESSAGES[loc].steps;
  return Array.isArray(steps) ? steps.map(String) : [];
}

export function memberLinkButtonLabel(
  locale: string | undefined,
  key: "done" | "startOver" | "askOfficer",
): string {
  const loc = normalizeLocale(locale);
  const buttons = MESSAGES[loc].buttons as Record<string, string> | undefined;
  return buttons?.[key] ?? key;
}
