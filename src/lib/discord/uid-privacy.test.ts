import { describe, expect, it } from "vitest";

import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";
import { t } from "@/lib/discord/i18n";

// A realistic Last War player UID (12–16 digits). Player UID is sensitive
// account-binding data and must never be echoed back after a successful link.
const SAMPLE_UID = "1234567890121203";

const UID_PLACEHOLDER = /\{(uid|gameUid|playerUid)\}/i;

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

describe("Discord linking copy never exposes player UID", () => {
  const successKeys = [
    "link.linked",
    "link.linkedAdditional",
    "link.updated",
    "link.replaced",
  ];

  it("does not render the UID in link success replies even if passed as a param", () => {
    for (const locale of ["en-US", "pt-BR"] as const) {
      for (const key of successKeys) {
        const reply = t(locale, key, {
          name: "Commander",
          // Defense-in-depth: even if a caller mistakenly threads the UID in,
          // these templates must not have a placeholder that surfaces it.
          gameUid: SAMPLE_UID,
          uid: SAMPLE_UID,
        });
        expect(reply).not.toContain(SAMPLE_UID);
        expect(reply).toContain("Commander");
      }
    }
  });

  it("has no UID placeholder in any discordBot link/setup template (en-US + pt-BR)", () => {
    for (const messages of [enUS, ptBR]) {
      const bot = messages.discordBot as Record<string, unknown>;
      const templates = [
        ...collectStrings(bot.link),
        ...collectStrings(bot.setup),
      ];
      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template).not.toMatch(UID_PLACEHOLDER);
      }
    }
  });

  it("has no UID placeholder in any discordAuthorize template (en-US + pt-BR)", () => {
    for (const messages of [enUS, ptBR]) {
      const templates = collectStrings(messages.discordAuthorize);
      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template).not.toMatch(UID_PLACEHOLDER);
      }
    }
  });
});
