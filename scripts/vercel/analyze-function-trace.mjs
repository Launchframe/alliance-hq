#!/usr/bin/env node
/**
 * Phase 0 — local mirror of Vercel VERCEL_ANALYZE_BUILD_OUTPUT for Next.js routes.
 *
 * Run after `npm run build` on linux-x64 (CI) to catch serverless bundles approaching
 * the 250 MB uncompressed limit before deploy.
 *
 * Usage:
 *   npm run build && npm run vercel:analyze-function-trace
 *
 * On Vercel, also set VERCEL_ANALYZE_BUILD_OUTPUT=1 for deploy-time breakdown in build logs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEffectiveTraceSet,
  formatMegabytes,
  summarizeTraceFiles,
} from "./trace-size.shared.mjs";
import {
  functionTraceBudgets,
  sharpNativeFileTracing,
  videoOcrFileTracingExcludes,
  videoOcrTracedRoutes,
} from "./video-ocr-file-tracing.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function printRouteReport({ route, summary, budgetBytes }) {
  const over = summary.totalBytes > budgetBytes;
  const budgetLabel = formatMegabytes(budgetBytes);
  const sizeLabel = formatMegabytes(summary.totalBytes);

  console.log(`\nFunction: ${route}`);
  console.log(
    `Size:     ${sizeLabel} uncompressed (${summary.fileCount} files, budget ${budgetLabel})${over ? " — OVER BUDGET" : ""}`,
  );

  const top = summary.breakdown.filter((row) => row.bytes >= 512 * 1024).slice(0, 12);
  if (top.length > 0) {
    console.log("Large dependencies:");
    for (const row of top) {
      console.log(`  • ${row.name}: ${formatMegabytes(row.bytes)}`);
    }
  }
}

function main() {
  const missingBuild = functionTraceBudgets.filter(
    ({ nftPath }) => !fs.existsSync(path.join(repoRoot, nftPath)),
  );

  if (missingBuild.length === functionTraceBudgets.length) {
    console.error(
      "No .next server NFT manifests found. Run `npm run build` first (linux-x64 CI matches Vercel best).",
    );
    process.exit(1);
  }

  let failed = false;

  for (const budget of functionTraceBudgets) {
    const nftAbs = path.join(repoRoot, budget.nftPath);
    if (!fs.existsSync(nftAbs)) {
      console.error(`Missing NFT manifest for ${budget.route}: ${budget.nftPath}`);
      failed = true;
      continue;
    }

    const routeIncludes = videoOcrTracedRoutes[budget.route] ?? [];
    const includes = [...sharpNativeFileTracing, ...routeIncludes];
    const files = buildEffectiveTraceSet({
      repoRoot,
      nftJsonPath: nftAbs,
      includes,
      excludes: videoOcrFileTracingExcludes,
    });

    if (budget.requireLibvips) {
      const hasLibvips = [...files].some((file) =>
        file.includes("libvips-cpp.so"),
      );
      if (!hasLibvips) {
        failed = true;
        console.error(
          `\n${budget.route} trace is missing libvips-cpp shared objects (global sharp tracing).`,
        );
      }
    }

    if (Array.isArray(budget.forbidPathSubstrings)) {
      const forbiddenHits = [...files].filter((file) =>
        budget.forbidPathSubstrings.some((needle) => file.includes(needle)),
      );
      if (forbiddenHits.length > 0) {
        failed = true;
        const sample = forbiddenHits.slice(0, 8).join("\n  • ");
        console.error(
          `\n${budget.route} trace includes forbidden OCR/native paths (dispatch-only route):`,
        );
        console.error(`  • ${sample}`);
        if (forbiddenHits.length > 8) {
          console.error(`  … and ${forbiddenHits.length - 8} more`);
        }
      }
    }

    const summary = summarizeTraceFiles(repoRoot, files);
    printRouteReport({
      route: budget.route,
      summary,
      budgetBytes: budget.maxUncompressedBytes,
    });

    if (summary.totalBytes > budget.maxUncompressedBytes) {
      failed = true;
      console.error(
        `\n${budget.route} exceeds budget (${formatMegabytes(summary.totalBytes)} > ${formatMegabytes(budget.maxUncompressedBytes)}).`,
      );
      console.error(
        "See scripts/vercel/analyze-function-trace.mjs and next.config.ts outputFileTracing.",
      );
      console.error(
        "On Vercel deploys, set VERCEL_ANALYZE_BUILD_OUTPUT=1 for the platform breakdown.",
      );
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log("\nFunction trace budgets OK.");
}

main();
