#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  LOCALES_CONFIG,
  MESSAGES_DIR,
  flattenMessages,
  loadMessages,
  protectString,
  restoreString,
  sortObjectKeys,
  unflattenMessages,
} from "./utils.mjs";

const BATCH_SIZE = 50;

function parseArgs(argv) {
  const args = { locale: null, dryRun: false, all: false };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--locale" && argv[i + 1]) {
      args.locale = argv[++i];
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[i] === "--all") {
      args.all = true;
    }
  }

  return args;
}

async function translateBatch(texts, targetCode, sourceCode) {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set GOOGLE_TRANSLATE_API_KEY to use automated translation (Google Cloud Translation API).",
    );
  }

  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("source", sourceCode);
  url.searchParams.set("target", targetCode);
  url.searchParams.set("format", "text");

  for (const text of texts) {
    url.searchParams.append("q", text);
  }

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Translation API failed with status ${response.status}`,
    );
  }

  return payload.data.translations.map((item) => item.translatedText);
}

async function translateLocale(locale, { dryRun }) {
  const sourceCode = LOCALES_CONFIG.googleSourceCode;
  const targetCode = LOCALES_CONFIG.googleTargetCodes[locale];

  if (!targetCode) {
    throw new Error(`No googleTargetCodes entry for locale "${locale}"`);
  }

  const source = loadMessages(LOCALES_CONFIG.source);
  const sourceFlat = flattenMessages(source);
  const existingFlat = flattenMessages(loadMessages(locale));

  const entries = [...sourceFlat.entries()].map(([key, value]) => {
    const protectedValue = protectString(value);
    return { key, value, protectedValue };
  });

  if (dryRun) {
    console.log(`[dry-run] Would translate ${entries.length} strings to ${locale}`);
    console.log(`Example protected input: ${entries[0].protectedValue.text}`);
    return;
  }

  const translatedFlat = new Map(existingFlat);

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const translatedTexts = await translateBatch(
      batch.map((entry) => entry.protectedValue.text),
      targetCode,
      sourceCode,
    );

    batch.forEach((entry, index) => {
      const restored = restoreString(
        translatedTexts[index],
        entry.protectedValue.placeholders,
      );
      translatedFlat.set(entry.key, restored);
    });

    console.log(
      `Translated ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} strings`,
    );
  }

  const output = sortObjectKeys(unflattenMessages(translatedFlat));
  const outPath = path.join(MESSAGES_DIR, `${locale}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const locales = args.all
    ? LOCALES_CONFIG.targets
    : args.locale
      ? [args.locale]
      : [];

  if (locales.length === 0) {
    console.error(
      "Usage: node scripts/i18n/translate.mjs --locale pt-BR [--dry-run]\n       node scripts/i18n/translate.mjs --all",
    );
    process.exit(1);
  }

  for (const locale of locales) {
    if (!LOCALES_CONFIG.targets.includes(locale)) {
      throw new Error(`Locale "${locale}" is not listed in scripts/i18n/locales.json`);
    }

    await translateLocale(locale, { dryRun: args.dryRun });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
