/**
 * Upstream tesseract.js@7 node getCore.js still compares the boolean `lstmOnly`
 * flag against OEM enum integers ([1, 3].includes(true) === false), so Node
 * always require()s the non-LSTM WASM cores. Browser getCore uses `if (lstmOnly)`.
 *
 * Without this patch, Vercel NFT that ships only LSTM cores fails with:
 *   Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'
 *
 * Idempotent — safe to re-run from postinstall.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PATCH_MARKER =
  "patched by alliance-hq scripts/patch-tesseract-node-getcore.mjs";

export const UPSTREAM_BUG_SIGNATURE =
  "[OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem)";

export const NATIVE_LSTM_ONLY_FIX = /if\s*\(\s*lstmOnly\s*\)/;

export const PATCHED_GET_CORE_SOURCE = `'use strict';

const { simd, relaxedSimd } = require('wasm-feature-detect');

let TesseractCore = null;
/*
 * Load TesseractCore for Node. First arg is boolean \`lstmOnly\` from createWorker
 * (same contract as browser getCore). Upstream incorrectly compared against OEM
 * enums — ${PATCH_MARKER}.
 */
module.exports = async (lstmOnly, _, res) => {
  if (TesseractCore === null) {
    const statusText = 'loading tesseract core';

    const simdSupport = await simd();
    const relaxedSimdSupport = await relaxedSimd();
    res.progress({ status: statusText, progress: 0 });
    if (relaxedSimdSupport) {
      if (lstmOnly) {
        TesseractCore = require('tesseract.js-core/tesseract-core-relaxedsimd-lstm');
      } else {
        TesseractCore = require('tesseract.js-core/tesseract-core-relaxedsimd');
      }
    } else if (simdSupport) {
      if (lstmOnly) {
        TesseractCore = require('tesseract.js-core/tesseract-core-simd-lstm');
      } else {
        TesseractCore = require('tesseract.js-core/tesseract-core-simd');
      }
    } else if (lstmOnly) {
      TesseractCore = require('tesseract.js-core/tesseract-core-lstm');
    } else {
      TesseractCore = require('tesseract.js-core/tesseract-core');
    }
    res.progress({ status: statusText, progress: 1 });
  }
  return TesseractCore;
};
`;

/**
 * @param {string} target Absolute path to node getCore.js
 * @returns {"missing" | "already_patched" | "native_fix" | "unexpected" | "patched"}
 */
export function patchGetCoreAtPath(target) {
  if (!existsSync(target)) {
    return "missing";
  }

  const current = readFileSync(target, "utf8");
  if (current.includes(PATCH_MARKER)) {
    return "already_patched";
  }

  if (NATIVE_LSTM_ONLY_FIX.test(current)) {
    return "native_fix";
  }

  if (!current.includes(UPSTREAM_BUG_SIGNATURE)) {
    return "unexpected";
  }

  writeFileSync(target, PATCHED_GET_CORE_SOURCE);
  return "patched";
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "patch-tesseract-node-getcore.mjs");

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.join(
    repoRoot,
    "node_modules/tesseract.js/src/worker-script/node/getCore.js",
  );

  const result = patchGetCoreAtPath(target);
  if (result === "missing") {
    console.warn(`[patch-tesseract-node-getcore] skip: missing ${target}`);
    process.exit(0);
  }
  if (result === "already_patched" || result === "native_fix") {
    process.exit(0);
  }
  if (result === "unexpected") {
    console.error(
      "[patch-tesseract-node-getcore] unexpected getCore.js contents; cannot verify lstmOnly fix",
    );
    process.exit(process.env.CI ? 1 : 0);
  }

  console.log("[patch-tesseract-node-getcore] patched node getCore for lstmOnly boolean");
}
