import { describe, expect, it, vi } from "vitest";

import { applyLocaleMessagePatch } from "@/lib/i18n/apply-locale-message";

describe("applyLocaleMessagePatch", () => {
  it("writes the suggested translation into the locale messages file", async () => {
    const initial = {
      feedback: {
        fab: {
          reportBug: "Reportar um bug",
        },
      },
    };
    const files = new Map([["pt-BR.json", `${JSON.stringify(initial, null, 2)}\n`]]);

    const result = await applyLocaleMessagePatch({
      locale: "pt-BR",
      i18nKey: "feedback.fab.reportBug",
      suggestedTranslation: "Reportar bug",
      readFile: async (filePath) => {
        const name = filePath.split("/").pop() ?? filePath;
        const content = files.get(name);
        if (!content) throw new Error(`missing ${name}`);
        return content;
      },
      writeFile: async (filePath, content) => {
        const name = filePath.split("/").pop() ?? filePath;
        files.set(name, content);
      },
      messagesDir: "/tmp/messages",
    });

    expect(result).toEqual({
      locale: "pt-BR",
      i18nKey: "feedback.fab.reportBug",
      previousValue: "Reportar um bug",
      newValue: "Reportar bug",
    });

    const updated = JSON.parse(files.get("pt-BR.json") ?? "{}") as {
      feedback: { fab: { reportBug: string } };
    };
    expect(updated.feedback.fab.reportBug).toBe("Reportar bug");
  });

  it("rejects unsupported locales", async () => {
    await expect(
      applyLocaleMessagePatch({
        locale: "fr-FR",
        i18nKey: "common.back",
        suggestedTranslation: "Retour",
        readFile: vi.fn(),
        writeFile: vi.fn(),
        messagesDir: "/tmp/messages",
      }),
    ).rejects.toThrow(/unsupported locale/i);
  });

  it("rejects missing i18n keys in the locale file", async () => {
    const files = new Map([
      [
        "pt-BR.json",
        `${JSON.stringify({ common: { back: "Voltar" } }, null, 2)}\n`,
      ],
    ]);

    await expect(
      applyLocaleMessagePatch({
        locale: "pt-BR",
        i18nKey: "feedback.fab.reportBug",
        suggestedTranslation: "Reportar bug",
        readFile: async () => files.get("pt-BR.json") ?? "",
        writeFile: vi.fn(),
        messagesDir: "/tmp/messages",
      }),
    ).rejects.toThrow(/does not exist/i);
  });
});
