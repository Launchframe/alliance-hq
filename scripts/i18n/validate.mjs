#!/usr/bin/env node
import process from "node:process";

import {
  LOCALES_CONFIG,
  extractMessageTokens,
  flattenMessages,
  loadMessages,
  setsEqual,
} from "./utils.mjs";

const ENGLISH_LEAK_WORDS = [
  "the ",
  "your ",
  "you ",
  "we ",
  "our ",
  "click ",
  "open ",
  "back ",
  "settings",
  "dashboard",
  "upload ",
  "connect ",
  "failed",
  "before ",
  "after ",
];

function isLikelyEnglishLeak(value, locale) {
  if (locale === LOCALES_CONFIG.source) {
    return false;
  }

  const lower = value.toLowerCase();
  const allowlist = [
    "alliance hq",
    "ashed",
    "ashed.online",
    "alliance-hq.online",
    "english (us)",
    "português (brasil)",
    "curl",
    "bearer",
    "devtools",
    "network",
    "headers",
    "reports",
    "github",
    "jwt",
    "ocr",
    "https",
    "postgres",
    "vercel",
    "neon",
    "chrome",
    "firefox",
    "safari",
    "connect",
    "upload",
    "upload de",
  ];

  for (const word of ENGLISH_LEAK_WORDS) {
    if (!lower.includes(word)) {
      continue;
    }

    const normalized = lower.replace(/[^a-z0-9()./ ]+/g, " ");
    if (allowlist.some((term) => normalized.includes(term))) {
      continue;
    }

    return word.trim();
  }

  return false;
}

function validateLocale(sourceFlat, locale) {
  const target = loadMessages(locale);
  const targetFlat = flattenMessages(target);
  const errors = [];
  const warnings = [];

  for (const [key, sourceValue] of sourceFlat) {
    if (!targetFlat.has(key)) {
      errors.push(`Missing key: ${key}`);
      continue;
    }

    const targetValue = targetFlat.get(key);
    const sourceTokens = extractMessageTokens(sourceValue);
    const targetTokens = extractMessageTokens(targetValue);

    if (!setsEqual(sourceTokens.vars, targetTokens.vars)) {
      errors.push(
        `Token mismatch at ${key}: vars ${JSON.stringify(sourceTokens.vars)} vs ${JSON.stringify(targetTokens.vars)}`,
      );
    }

    if (!setsEqual(sourceTokens.icuBlocks, targetTokens.icuBlocks)) {
      errors.push(
        `ICU mismatch at ${key}: ${JSON.stringify(sourceTokens.icuBlocks)} vs ${JSON.stringify(targetTokens.icuBlocks)}`,
      );
    }

    if (!setsEqual(sourceTokens.richTags, targetTokens.richTags)) {
      errors.push(
        `Rich-tag mismatch at ${key}: ${JSON.stringify(sourceTokens.richTags)} vs ${JSON.stringify(targetTokens.richTags)}`,
      );
    }

    const leak = isLikelyEnglishLeak(targetValue, locale);
    if (leak) {
      warnings.push(`Possible English leak at ${key} (matched "${leak}")`);
    }
  }

  for (const key of targetFlat.keys()) {
    if (!sourceFlat.has(key)) {
      errors.push(`Extra key: ${key}`);
    }
  }

  return { errors, warnings };
}

function main() {
  const source = loadMessages(LOCALES_CONFIG.source);
  const sourceFlat = flattenMessages(source);
  const locales = LOCALES_CONFIG.targets;
  let failed = false;

  for (const locale of locales) {
    const { errors, warnings } = validateLocale(sourceFlat, locale);
    console.log(`\n[${locale}]`);

    if (errors.length === 0 && warnings.length === 0) {
      console.log("  OK");
      continue;
    }

    for (const error of errors) {
      failed = true;
      console.error(`  ERROR: ${error}`);
    }

    for (const warning of warnings) {
      console.warn(`  WARN: ${warning}`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main();
