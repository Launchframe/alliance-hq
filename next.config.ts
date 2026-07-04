import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import packageJson from "./package.json" with { type: "json" };

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Vercel serverless runs linux-x64 — avoid tracing every @img platform binary. */
const sharpFileTracing = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

/**
 * In-house roster OCR (tesseract.js v7). createWorker("eng", 1) loads an LSTM
 * core variant at runtime (see worker-script/node/getCore.js). Include the three
 * LSTM fallbacks only — not the full tesseract.js-core tree (6+ WASM builds).
 * traineddata comes from jsDelivr unless TESSERACT_LANG_PATH is set.
 */
const TESSERACT_LSTM_CORE_VARIANTS = [
  "relaxedsimd-lstm",
  "simd-lstm",
  "lstm",
] as const;

const tesseractFileTracing = [
  "./node_modules/tesseract.js/src/worker-script/**/*",
  "./node_modules/tesseract.js/src/worker/node/**/*",
  "./node_modules/wasm-feature-detect/**/*",
  "./node_modules/tesseract.js-core/index.js",
  "./node_modules/tesseract.js-core/package.json",
  ...TESSERACT_LSTM_CORE_VARIANTS.flatMap((variant) => [
    `./node_modules/tesseract.js-core/tesseract-core-${variant}.js`,
    `./node_modules/tesseract.js-core/tesseract-core-${variant}.wasm`,
    `./node_modules/tesseract.js-core/tesseract-core-${variant}.wasm.js`,
  ]),
];

const videoOcrFileTracing = [...sharpFileTracing, ...tesseractFileTracing];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ?? packageJson.version,
  },
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  outputFileTracingIncludes: {
    "/guides/discord-train": ["./docs/guides/**/*"],
    "/api/internal/video-process/queue": videoOcrFileTracing,
    "/api/internal/video-process/[jobId]": videoOcrFileTracing,
    "/api/members/roster-import/parse": videoOcrFileTracing,
  },
  outputFileTracingExcludes: {
    "*": [
      // Non-LSTM cores are never selected for roster OCR (OEM.LSTM_ONLY).
      "./node_modules/tesseract.js-core/tesseract-core.js",
      "./node_modules/tesseract.js-core/tesseract-core.wasm",
      "./node_modules/tesseract.js-core/tesseract-core.wasm.js",
      "./node_modules/tesseract.js-core/tesseract-core-simd.js",
      "./node_modules/tesseract.js-core/tesseract-core-simd.wasm",
      "./node_modules/tesseract.js-core/tesseract-core-simd.wasm.js",
      "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.js",
      "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm",
      "./node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js",
    ],
  },
  serverExternalPackages: ["ffmpeg-static", "sharp"],
};

export default withNextIntl(nextConfig);
