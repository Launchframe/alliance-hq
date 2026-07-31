#!/usr/bin/env node
/**
 * Offline hit-rate probe for deposit-slip tolerant parsers.
 *
 * Runs strict vs tolerant code paths on fixture strings (from production OCR
 * investigations) and prints a table for docs/engineering/deposit-slip-ocr-hardening-audit.md.
 *
 * Usage:
 *   node scripts/measure-deposit-slip-ocr-hardening.mjs
 *
 * For production-scale hit rates, re-run against `ocr_raw_json` lines from recent
 * `bank-deposit-slip-history` jobs (see audit doc § Measurement methodology).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load compiled parsers via tsx-free path: import from built test fixtures is heavy;
// duplicate minimal strict probes inline for measurement only.

const DEPOSIT_STRICT_RE =
  /Deposit:\s*CrystalGold\s*x\s*([\d,]+)\s*,\s*Term:\s*(\d+)\s*day/i;
const DEPOSIT_KEYWORD_RE = /[doq][ea]p[oa][s5][i1l]t\s*:/i;
const CRYSTALGOLD_TOLERANT_RE = /crystal\s*g[oa0][l1]d/i;
const TERM_DAYS_RE = /Term:\s*(\d+)\s*day/i;

const DEPOSIT_FIXTURES = [
  { label: "clean", line: "Deposit: CrystalGold x 6000, Term: 5 days." },
  { label: "garbled_deposit_keyword", line: "| 2 Oepasit: CrystalGold x 6000, Term: 5 days." },
  { label: "garbled_crystalgold", line: "Deposit: CrystalGald x 6000, Term: 5 days." },
  { label: "period_instead_of_comma", line: "| Deposit: CrystalGold x 6000. Term: 5 day(s)." },
  { label: "garbled_amount_letters", line: "ty Oepasit: CrystalGald x BODO, Term: 5 day(s)" },
  { label: "garbled_amount_partial", line: ": Deposit: CrystalGold x BO00. Term: 5 days." },
  { label: "unrelated_noise", line: "some unrelated line of OCR noise" },
];

function strictDeposit(line) {
  const m = line.match(DEPOSIT_STRICT_RE);
  if (!m) return null;
  return { amount: m[1], termDays: m[2] };
}

function tolerantDeposit(line) {
  if (!DEPOSIT_KEYWORD_RE.test(line) || !CRYSTALGOLD_TOLERANT_RE.test(line)) {
    return null;
  }
  const term = line.match(TERM_DAYS_RE);
  const amount = line.match(/\bx\s*([\d,]+)\s*[,.]?\s*Term/i);
  if (!term && !amount) return null;
  return {
    amount: amount?.[1] ?? null,
    termDays: term?.[1] ?? null,
  };
}

function measureDepositFixtures() {
  let strictHits = 0;
  let tolerantOnly = 0;
  const rows = [];
  for (const { label, line } of DEPOSIT_FIXTURES) {
    const s = strictDeposit(line);
    const t = tolerantDeposit(line);
    if (s) strictHits += 1;
    if (t && !s) tolerantOnly += 1;
    rows.push({
      fixture: label,
      strict: s ? "hit" : "miss",
      tolerant: t ? "hit" : "miss",
      tolerant_only: Boolean(t && !s),
    });
  }
  return { rows, strictHits, tolerantOnly, total: DEPOSIT_FIXTURES.length };
}

function main() {
  const deposit = measureDepositFixtures();
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), deposit }, null, 2));
}

main();
