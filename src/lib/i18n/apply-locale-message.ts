import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { locales, type AppLocale } from "@/i18n/routing";

import {
  getNestedMessageValue,
  I18nKeyNotFoundError,
  I18nKeyNotStringLeafError,
  setNestedMessageValue,
} from "./messages-patch";

export { I18nKeyNotFoundError, I18nKeyNotStringLeafError };

export class UnsupportedLocaleError extends Error {
  constructor(locale: string) {
    super(`Unsupported locale: ${locale}`);
    this.name = "UnsupportedLocaleError";
  }
}

export type LocaleMessagePatchResult = {
  locale: AppLocale;
  i18nKey: string;
  previousValue: string;
  newValue: string;
};

export type ApplyLocaleMessagePatchInput = {
  locale: string;
  i18nKey: string;
  suggestedTranslation: string;
  messagesDir?: string;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
};

function isAppLocale(locale: string): locale is AppLocale {
  return (locales as readonly string[]).includes(locale);
}

export async function applyLocaleMessagePatch(
  input: ApplyLocaleMessagePatchInput,
): Promise<LocaleMessagePatchResult> {
  const { locale, i18nKey, suggestedTranslation } = input;
  if (!isAppLocale(locale)) {
    throw new UnsupportedLocaleError(locale);
  }

  const messagesDir =
    input.messagesDir ?? path.join(process.cwd(), "messages");
  const filePath = path.join(messagesDir, `${locale}.json`);
  const read = input.readFile ?? ((p) => readFile(p, "utf8"));
  const write = input.writeFile ?? ((p, c) => writeFile(p, c, "utf8"));

  const raw = await read(filePath);
  const messages = JSON.parse(raw) as Record<string, unknown>;

  const previous = getNestedMessageValue(messages, i18nKey);
  if (typeof previous !== "string") {
    throw new I18nKeyNotStringLeafError(i18nKey);
  }

  setNestedMessageValue(messages, i18nKey, suggestedTranslation);

  await write(filePath, `${JSON.stringify(messages, null, 2)}\n`);

  return {
    locale,
    i18nKey,
    previousValue: previous,
    newValue: suggestedTranslation,
  };
}
