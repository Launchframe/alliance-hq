import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveTranslationKeysFromClient } from "@/lib/feedback/translation-key-resolve";

export function resolveTranslationKeys(
  locale: string,
  displayedText: string,
): { i18nKey: string | null; candidateKeys: string[] } {
  const filePath = path.join(process.cwd(), "messages", `${locale}.json`);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
  return resolveTranslationKeysFromClient(raw, displayedText);
}
