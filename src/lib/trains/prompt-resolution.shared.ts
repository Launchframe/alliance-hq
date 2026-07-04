import type { ConductorMechanismType } from "@/lib/trains/types";

export type PromptResolutionContext = {
  commander: {
    name: string;
    bio?: string | null;
  };
  alliance: {
    name: string;
    tag: string;
  };
  seasonKey: string | null;
  seasonLabel?: string | null;
  conductorMechanism: ConductorMechanismType | string | null;
  conductorMechanismLabel?: string | null;
  yesterdayVsScore?: number | null;
  date?: string | null;
  vip?: { name: string | null };
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function flattenPromptContext(
  context: PromptResolutionContext,
): Record<string, string | number | null | undefined> {
  return {
    "commander.name": context.commander.name,
    "commander.bio": context.commander.bio,
    "alliance.name": context.alliance.name,
    "alliance.tag": context.alliance.tag,
    seasonKey: context.seasonKey,
    season_key: context.seasonKey,
    seasonLabel: context.seasonLabel ?? null,
    season_label: context.seasonLabel ?? null,
    conductorMechanism: context.conductorMechanism,
    conductorMechanismLabel:
      context.conductorMechanismLabel ?? context.conductorMechanism,
    conductor_mechanism_label:
      context.conductorMechanismLabel ?? context.conductorMechanism,
    yesterdayVsScore: context.yesterdayVsScore ?? null,
    yesterday_vs_score: context.yesterdayVsScore ?? null,
    date: context.date ?? null,
    "vip.name": context.vip?.name ?? null,
  };
}

/** Substitute `{{dotted.path}}` placeholders in a prompt template body. */
export function resolvePromptTemplateBody(
  body: string,
  context: PromptResolutionContext,
): string {
  const values = flattenPromptContext(context);
  return body.replace(VARIABLE_PATTERN, (_match, rawPath: string) => {
    const value = values[rawPath];
    if (value == null || value === "") return "";
    return String(value);
  });
}

export const PROMPT_TEMPLATE_VARIABLES = [
  "commander.name",
  "commander.bio",
  "alliance.name",
  "alliance.tag",
  "season_key",
  "season_label",
  "conductor_mechanism_label",
  "yesterday_vs_score",
  "date",
  "vip.name",
] as const;

/** Resolve prompt body, accepting both dotted and snake_case variable names. */
export function resolvePromptTemplateBodyWithLegacy(
  body: string,
  context: PromptResolutionContext,
): string {
  const enriched: PromptResolutionContext = {
    ...context,
    seasonLabel:
      context.seasonLabel ??
      (context.seasonKey ? `Season ${context.seasonKey}` : null),
    conductorMechanismLabel:
      context.conductorMechanismLabel ?? String(context.conductorMechanism ?? ""),
  };
  return resolvePromptTemplateBody(body, enriched);
}
